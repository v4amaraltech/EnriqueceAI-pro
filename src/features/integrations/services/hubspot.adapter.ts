import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmProvider,
} from '../types/crm';

const HUBSPOT_AUTH_URL = 'https://app.hubspot.com/oauth/authorize';
const HUBSPOT_TOKEN_URL = 'https://api.hubapi.com/oauth/v1/token';
const HUBSPOT_API_BASE = 'https://api.hubapi.com';

const HUBSPOT_CLIENT_ID = process.env.HUBSPOT_CLIENT_ID ?? '';
const HUBSPOT_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? '';

const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.objects.companies.read',
  'crm.objects.companies.write',
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.schemas.contacts.read',
  'crm.schemas.deals.write',
  'sales-email-read',
  'timeline',
];

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  hub_id?: number;
}

interface HubSpotContact {
  id: string;
  properties: Record<string, string | null>;
  updatedAt: string;
}

interface HubSpotSearchResponse {
  results: HubSpotContact[];
  paging?: { next?: { after: string } };
}

interface HubSpotCreateResponse {
  id: string;
  properties: Record<string, string | null>;
}

interface HubSpotEngagementResponse {
  id: string;
}

interface HubSpotPipelineResponse {
  results: Array<{ id: string; label: string }>;
}

interface HubSpotStageResponse {
  results: Array<{ id: string; label: string; displayOrder: number }>;
}

interface HubSpotDealResponse {
  id: string;
  properties: Record<string, string | null>;
}

async function hubspotFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${HUBSPOT_API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HubSpot API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

export class HubSpotAdapter implements CRMAdapter {
  readonly provider: CrmProvider = 'hubspot';

  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: HUBSPOT_CLIENT_ID,
      redirect_uri: redirectUri,
      scope: HUBSPOT_SCOPES.join(' '),
      response_type: 'code',
    });

    return `${HUBSPOT_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CrmCredentials> {
    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HubSpot token exchange failed: ${errorText}`);
    }

    const tokens = (await response.json()) as HubSpotTokenResponse;

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
      portal_id: tokens.hub_id?.toString(),
    };
  }

  async refreshToken(credentials: CrmCredentials): Promise<CrmCredentials> {
    if (!credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(HUBSPOT_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: HUBSPOT_CLIENT_ID,
        client_secret: HUBSPOT_CLIENT_SECRET,
        refresh_token: credentials.refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error('HubSpot token refresh failed');
    }

    const tokens = (await response.json()) as HubSpotTokenResponse;

    return {
      ...credentials,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
    };
  }

  async pullContacts(
    credentials: CrmCredentials,
    since?: string,
  ): Promise<CrmContact[]> {
    const contacts: CrmContact[] = [];
    let after: string | undefined;

    const filterGroups = since
      ? [
          {
            filters: [
              {
                propertyName: 'lastmodifieddate',
                operator: 'GTE',
                value: new Date(since).getTime().toString(),
              },
            ],
          },
        ]
      : [];

    // Paginate through all contacts (max 10 pages = 1000 contacts per sync)
    for (let page = 0; page < 10; page++) {
      const body: Record<string, unknown> = {
        limit: 100,
        properties: [
          'email',
          'firstname',
          'lastname',
          'company',
          'phone',
          'hs_additional_id',
          'hs_lead_status',
          'company_size',
          'industry',
        ],
        sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }],
      };

      if (filterGroups.length > 0) {
        body.filterGroups = filterGroups;
      }
      if (after) {
        body.after = after;
      }

      const result = await hubspotFetch<HubSpotSearchResponse>(
        '/crm/v3/objects/contacts/search',
        credentials.access_token,
        { method: 'POST', body: JSON.stringify(body) },
      );

      for (const contact of result.results) {
        contacts.push({
          external_id: contact.id,
          email: contact.properties.email ?? null,
          company_name: contact.properties.company ?? null,
          phone: contact.properties.phone ?? null,
          properties: contact.properties,
          updated_at: contact.updatedAt,
        });
      }

      if (!result.paging?.next?.after) break;
      after = result.paging.next.after;
    }

    return contacts;
  }

  async pushContact(
    credentials: CrmCredentials,
    lead: Record<string, string | null>,
    fieldMapping: Record<string, string>,
    externalId?: string,
  ): Promise<{ external_id: string }> {
    // Map EnriqueceAI fields to HubSpot properties
    const properties: Record<string, string> = {};
    for (const [appField, crmField] of Object.entries(fieldMapping)) {
      const value = lead[appField];
      if (value !== null && value !== undefined) {
        properties[crmField] = value;
      }
    }

    if (externalId) {
      // Update existing contact
      await hubspotFetch<HubSpotCreateResponse>(
        `/crm/v3/objects/contacts/${externalId}`,
        credentials.access_token,
        { method: 'PATCH', body: JSON.stringify({ properties }) },
      );
      return { external_id: externalId };
    }

    // Create new contact — handle 409 CONFLICT (contact already exists)
    try {
      const result = await hubspotFetch<HubSpotCreateResponse>(
        '/crm/v3/objects/contacts',
        credentials.access_token,
        { method: 'POST', body: JSON.stringify({ properties }) },
      );
      return { external_id: result.id };
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      const existingIdMatch = msg.match(/Existing ID:\s*(\d+)/);
      if (existingIdMatch?.[1]) {
        const existingId = existingIdMatch[1];
        await hubspotFetch<HubSpotCreateResponse>(
          `/crm/v3/objects/contacts/${existingId}`,
          credentials.access_token,
          { method: 'PATCH', body: JSON.stringify({ properties }) },
        );
        return { external_id: existingId };
      }
      throw error;
    }
  }

  async pushActivity(
    credentials: CrmCredentials,
    activity: {
      contact_external_id: string;
      type: string;
      subject: string;
      body: string;
      timestamp: string;
    },
  ): Promise<{ external_id: string }> {
    // Map activity type to HubSpot engagement type
    const engagementType = this.mapActivityType(activity.type);

    const engagement = {
      properties: {
        hs_timestamp: new Date(activity.timestamp).getTime().toString(),
        hs_activity_type: engagementType,
        ...(engagementType === 'NOTE'
          ? { hs_note_body: `${activity.subject}\n\n${activity.body}` }
          : { hs_body_preview: activity.body }),
      },
      associations: [
        {
          to: { id: activity.contact_external_id },
          types: [
            {
              associationCategory: 'HUBSPOT_DEFINED',
              associationTypeId: engagementType === 'NOTE' ? 202 : 198,
            },
          ],
        },
      ],
    };

    const objectType = engagementType === 'NOTE' ? 'notes' : 'emails';
    const result = await hubspotFetch<HubSpotEngagementResponse>(
      `/crm/v3/objects/${objectType}`,
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(engagement) },
    );

    return { external_id: result.id };
  }

  async validateConnection(credentials: CrmCredentials): Promise<boolean> {
    try {
      await hubspotFetch<{ portalId: number }>(
        '/integrations/v1/me',
        credentials.access_token,
      );
      return true;
    } catch {
      return false;
    }
  }

  async fetchPipelines(
    credentials: CrmCredentials,
  ): Promise<Array<{ id: string; label: string }>> {
    const result = await hubspotFetch<HubSpotPipelineResponse>(
      '/crm/v3/pipelines/deals',
      credentials.access_token,
    );
    return result.results;
  }

  async fetchStages(
    credentials: CrmCredentials,
    pipelineId: string,
  ): Promise<Array<{ id: string; label: string; displayOrder: number }>> {
    const result = await hubspotFetch<HubSpotStageResponse>(
      `/crm/v3/pipelines/deals/${pipelineId}/stages`,
      credentials.access_token,
    );
    return result.results;
  }

  async pushCompany(
    credentials: CrmCredentials,
    company: { name: string; address?: string; city?: string; state?: string; zip?: string; phone?: string },
  ): Promise<{ external_id: string }> {
    const properties: Record<string, string> = { name: company.name };
    if (company.address) properties.address = company.address;
    if (company.city) properties.city = company.city;
    if (company.state) properties.state = company.state;
    if (company.zip) properties.zip = company.zip;
    if (company.phone) properties.phone = company.phone;

    const result = await hubspotFetch<HubSpotCreateResponse>(
      '/crm/v3/objects/companies',
      credentials.access_token,
      { method: 'POST', body: JSON.stringify({ properties }) },
    );
    return { external_id: result.id };
  }

  async associateContactToCompany(
    credentials: CrmCredentials,
    contactId: string,
    companyId: string,
  ): Promise<void> {
    await hubspotFetch<unknown>(
      `/crm/v4/objects/contacts/${contactId}/associations/companies/${companyId}`,
      credentials.access_token,
      {
        method: 'PUT',
        body: JSON.stringify([
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 1 },
        ]),
      },
    );
  }

  async ensureOrigemProperty(credentials: CrmCredentials): Promise<void> {
    try {
      await hubspotFetch<unknown>(
        '/crm/v3/properties/deals/origem',
        credentials.access_token,
      );
    } catch {
      await hubspotFetch<unknown>(
        '/crm/v3/properties/deals',
        credentials.access_token,
        {
          method: 'POST',
          body: JSON.stringify({
            name: 'origem',
            label: 'Origem',
            type: 'string',
            fieldType: 'text',
            groupName: 'dealinformation',
          }),
        },
      );
    }
  }

  async pushDeal(
    credentials: CrmCredentials,
    deal: { title: string; contactId: string; pipelineId: string; stageId: string; companyId?: string; customProperties?: Record<string, string> },
  ): Promise<{ external_id: string }> {
    const associations = [
      {
        to: { id: deal.contactId },
        types: [
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 },
        ],
      },
    ];
    if (deal.companyId) {
      associations.push({
        to: { id: deal.companyId },
        types: [
          { associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 },
        ],
      });
    }

    const result = await hubspotFetch<HubSpotDealResponse>(
      '/crm/v3/objects/deals',
      credentials.access_token,
      {
        method: 'POST',
        body: JSON.stringify({
          properties: {
            dealname: deal.title,
            pipeline: deal.pipelineId,
            dealstage: deal.stageId,
            ...deal.customProperties,
          },
          associations,
        }),
      },
    );
    return { external_id: result.id };
  }

  private mapActivityType(type: string): string {
    switch (type) {
      case 'email':
      case 'sent':
        return 'EMAIL';
      case 'whatsapp':
        return 'NOTE';
      case 'meeting_scheduled':
        return 'MEETING';
      case 'call':
        return 'CALL';
      default:
        return 'NOTE';
    }
  }
}
