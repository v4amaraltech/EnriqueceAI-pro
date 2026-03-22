import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmProvider,
} from '../types/crm';

const KOMMO_AUTH_URL = 'https://www.kommo.com/oauth';

const KOMMO_CLIENT_ID = process.env.KOMMO_CLIENT_ID ?? '';
const KOMMO_CLIENT_SECRET = process.env.KOMMO_CLIENT_SECRET ?? '';

interface KommoTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
  refresh_token: string;
}

interface KommoContact {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  responsible_user_id: number;
  updated_at: number;
  custom_fields_values: KommoCustomField[] | null;
  _embedded?: {
    companies?: Array<{ id: number; name?: string }>;
    tags?: Array<{ id: number; name: string }>;
  };
}

interface KommoCustomField {
  field_id: number;
  field_name: string;
  field_code: string | null;
  values: Array<{ value: string; enum_code?: string }>;
}

interface KommoListResponse<T> {
  _embedded: Record<string, T[]>;
  _page?: number;
  _links?: { self: { href: string }; next?: { href: string } };
}

interface KommoCreateResponse {
  _embedded: {
    leads?: Array<{ id: number; request_id: string }>;
    contacts?: Array<{ id: number; request_id: string }>;
  };
}

interface KommoAccountResponse {
  id: number;
  name: string;
  subdomain: string;
}

async function kommoFetch<T>(
  subdomain: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`https://${subdomain}.kommo.com/api/v4${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (response.status === 204) {
    return {} as T;
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kommo API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

function extractCustomFieldValue(
  fields: KommoCustomField[] | null,
  fieldCode: string,
): string | null {
  if (!fields) return null;
  const field = fields.find((f) => f.field_code === fieldCode);
  return field?.values[0]?.value ?? null;
}

/**
 * Extract the subdomain from a Kommo referer value.
 * Kommo sends the full domain (e.g. "myaccount.kommo.com") — we need just "myaccount".
 */
function extractSubdomain(referer: string): string {
  return referer
    .replace(/\.kommo\.com$/i, '')
    .replace(/\.amocrm\.com$/i, '')
    .trim();
}

export class KommoAdapter implements CRMAdapter {
  readonly provider: CrmProvider = 'kommo';

  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: KOMMO_CLIENT_ID,
      redirect_uri: redirectUri,
      state: crypto.randomUUID(),
    });

    return `${KOMMO_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
    subdomain?: string,
  ): Promise<CrmCredentials> {
    if (!subdomain) {
      throw new Error('Kommo requires subdomain (referer) from OAuth callback');
    }

    const cleanSubdomain = extractSubdomain(subdomain);
    const tokenUrl = `https://${cleanSubdomain}.kommo.com/oauth2/access_token`;

    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: KOMMO_CLIENT_ID,
          client_secret: KOMMO_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
        }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Kommo fetch to ${tokenUrl} failed: ${msg}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Kommo token exchange failed (${response.status}): ${errorText}`);
    }

    const tokens = (await response.json()) as KommoTokenResponse;

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
      subdomain: cleanSubdomain,
    };
  }

  async refreshToken(credentials: CrmCredentials): Promise<CrmCredentials> {
    if (!credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    const subdomain = credentials.subdomain;
    if (!subdomain) {
      throw new Error('No subdomain available for Kommo token refresh');
    }

    const response = await fetch(
      `https://${subdomain}.kommo.com/oauth2/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: KOMMO_CLIENT_ID,
          client_secret: KOMMO_CLIENT_SECRET,
          grant_type: 'refresh_token',
          refresh_token: credentials.refresh_token,
          redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/api/auth/callback/kommo`,
        }),
      },
    );

    if (!response.ok) {
      throw new Error('Kommo token refresh failed');
    }

    const tokens = (await response.json()) as KommoTokenResponse;

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
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    const contacts: CrmContact[] = [];
    let page = 1;
    const maxPages = 10;

    while (page <= maxPages) {
      const params = new URLSearchParams({
        limit: '250',
        page: page.toString(),
        with: 'leads,companies',
      });

      if (since) {
        params.set(
          'filter[updated_at][from]',
          Math.floor(new Date(since).getTime() / 1000).toString(),
        );
      }

      try {
        const result = await kommoFetch<KommoListResponse<KommoContact>>(
          subdomain,
          `/contacts?${params.toString()}`,
          credentials.access_token,
        );

        const kommoContacts = result._embedded?.contacts ?? [];
        if (kommoContacts.length === 0) break;

        for (const contact of kommoContacts) {
          const email = extractCustomFieldValue(
            contact.custom_fields_values,
            'EMAIL',
          );
          const phone = extractCustomFieldValue(
            contact.custom_fields_values,
            'PHONE',
          );
          const companyName =
            contact._embedded?.companies?.[0]?.name ?? null;

          contacts.push({
            external_id: contact.id.toString(),
            email,
            company_name: companyName,
            phone,
            properties: {
              name: contact.name,
              first_name: contact.first_name,
              last_name: contact.last_name,
              email,
              phone,
              company_name: companyName,
            },
            updated_at: new Date(contact.updated_at * 1000).toISOString(),
          });
        }

        if (!result._links?.next) break;
        page++;
      } catch {
        break;
      }
    }

    return contacts;
  }

  async pushContact(
    credentials: CrmCredentials,
    lead: Record<string, string | null>,
    fieldMapping: Record<string, string>,
    externalId?: string,
  ): Promise<{ external_id: string }> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    // Build custom fields from mapping
    const customFields: KommoCustomField[] = [];
    let contactName = '';

    for (const [appField, crmField] of Object.entries(fieldMapping)) {
      const value = lead[appField];
      if (!value) continue;

      if (crmField === 'first_name' || crmField === 'last_name') {
        // Direct contact fields, handled below
        continue;
      }
      if (crmField === 'company_name') {
        // Will be used as company
        continue;
      }
      if (crmField === 'PHONE' || crmField === 'EMAIL') {
        customFields.push({
          field_id: 0,
          field_name: crmField,
          field_code: crmField,
          values: [
            {
              value,
              enum_code: crmField === 'PHONE' ? 'MOB' : 'WORK',
            },
          ],
        });
      }
    }

    // Build contact name
    const firstName = lead[Object.keys(fieldMapping).find((k) => fieldMapping[k] === 'first_name') ?? ''];
    const lastName = lead[Object.keys(fieldMapping).find((k) => fieldMapping[k] === 'last_name') ?? ''];
    contactName = [firstName, lastName].filter(Boolean).join(' ') || lead.nome_fantasia || 'Contato';

    if (externalId) {
      // Update existing contact
      const body = {
        name: contactName,
        custom_fields_values: customFields.map((f) => ({
          field_code: f.field_code,
          values: f.values,
        })),
      };

      await kommoFetch<unknown>(
        subdomain,
        `/contacts/${externalId}`,
        credentials.access_token,
        { method: 'PATCH', body: JSON.stringify(body) },
      );
      return { external_id: externalId };
    }

    // Create via /leads/complex (lead + contact + company in one call)
    const companyNameField = Object.keys(fieldMapping).find(
      (k) => fieldMapping[k] === 'company_name',
    );
    const companyName = companyNameField ? lead[companyNameField] : null;

    const complexPayload = [
      {
        name: companyName || contactName,
        _embedded: {
          contacts: [
            {
              name: contactName,
              first_name: firstName || undefined,
              last_name: lastName || undefined,
              custom_fields_values: customFields.map((f) => ({
                field_code: f.field_code,
                values: f.values,
              })),
            },
          ],
          ...(companyName
            ? { companies: [{ name: companyName }] }
            : {}),
        },
      },
    ];

    const result = await kommoFetch<KommoCreateResponse>(
      subdomain,
      '/leads/complex',
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(complexPayload) },
    );

    const createdId = result._embedded?.leads?.[0]?.id;
    if (!createdId) {
      throw new Error('Kommo: failed to create lead, no ID returned');
    }

    return { external_id: createdId.toString() };
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
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    // Kommo uses notes on leads/contacts for activity tracking
    const notePayload = [
      {
        note_type: 'common',
        params: {
          text: `[${activity.type}] ${activity.subject}\n\n${activity.body}`,
        },
      },
    ];

    const result = await kommoFetch<{
      _embedded: { notes: Array<{ id: number }> };
    }>(
      subdomain,
      `/contacts/${activity.contact_external_id}/notes`,
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(notePayload) },
    );

    const noteId = result._embedded?.notes?.[0]?.id;
    return { external_id: noteId?.toString() ?? '' };
  }

  // --- Kommo-specific methods (not part of CRMAdapter interface) ---

  async fetchPipelines(
    credentials: CrmCredentials,
  ): Promise<Array<{ id: number; name: string }>> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    const result = await kommoFetch<KommoListResponse<{ id: number; name: string; sort: number }>>(
      subdomain,
      '/leads/pipelines',
      credentials.access_token,
    );

    return (result._embedded?.pipelines ?? []).map((p) => ({
      id: p.id,
      name: p.name,
    }));
  }

  async fetchStages(
    credentials: CrmCredentials,
    pipelineId: number,
  ): Promise<Array<{ id: number; name: string; sort: number }>> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    const result = await kommoFetch<KommoListResponse<{ id: number; name: string; sort: number }>>(
      subdomain,
      `/leads/pipelines/${pipelineId}/statuses`,
      credentials.access_token,
    );

    return (result._embedded?.statuses ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      sort: s.sort,
    }));
  }

  async pushDeal(
    credentials: CrmCredentials,
    options: {
      title: string;
      contactExternalId: string;
      pipelineId: number;
      stageId: number;
    },
  ): Promise<{ external_id: string }> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    const payload = [
      {
        name: options.title,
        pipeline_id: options.pipelineId,
        status_id: options.stageId,
        _embedded: {
          contacts: [{ id: parseInt(options.contactExternalId, 10) }],
        },
      },
    ];

    const result = await kommoFetch<KommoCreateResponse>(
      subdomain,
      '/leads',
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(payload) },
    );

    const createdId = result._embedded?.leads?.[0]?.id;
    if (!createdId) {
      throw new Error('Kommo: failed to create deal/lead, no ID returned');
    }

    return { external_id: createdId.toString() };
  }

  async validateConnection(credentials: CrmCredentials): Promise<boolean> {
    const subdomain = credentials.subdomain;
    if (!subdomain) return false;

    try {
      await kommoFetch<KommoAccountResponse>(
        subdomain,
        '/account',
        credentials.access_token,
      );
      return true;
    } catch {
      return false;
    }
  }
}
