import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmProvider,
} from '../types/crm';

const PIPEDRIVE_AUTH_URL = 'https://oauth.pipedrive.com/oauth/authorize';
const PIPEDRIVE_TOKEN_URL = 'https://oauth.pipedrive.com/oauth/token';

function getPipedriveClientId() {
  return process.env.PIPEDRIVE_CLIENT_ID ?? '';
}
function getPipedriveClientSecret() {
  return process.env.PIPEDRIVE_CLIENT_SECRET ?? '';
}

interface PipedriveTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  api_domain: string;
}

interface PipedrivePersonsResponse {
  success: boolean;
  data: PipedrivePerson[] | null;
  additional_data?: { pagination?: { next_start?: number; more_items_in_collection?: boolean } };
}

interface PipedrivePerson {
  id: number;
  name: string;
  email: Array<{ value: string; primary: boolean }>;
  phone: Array<{ value: string; primary: boolean }>;
  org_name: string | null;
  update_time: string;
  [key: string]: unknown;
}

interface PipedriveCreateResponse {
  success: boolean;
  data: { id: number };
}

interface PipedrivePipelineResponse {
  success: boolean;
  data: Array<{ id: number; name: string; active: boolean; deal_probability: boolean }> | null;
}

interface PipedriveStageResponse {
  success: boolean;
  data: Array<{ id: number; name: string; pipeline_id: number; order_nr: number }> | null;
}

interface PipedriveDealCreateResponse {
  success: boolean;
  data: { id: number };
}

async function pipedriveFetch<T>(
  apiDomain: string,
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
  const baseUrl = apiDomain || 'https://api.pipedrive.com';
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Pipedrive API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

export class PipedriveAdapter implements CRMAdapter {
  readonly provider: CrmProvider = 'pipedrive';

  getAuthUrl(redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: getPipedriveClientId(),
      redirect_uri: redirectUri,
      state: 'pipedrive',
    });
    return `${PIPEDRIVE_AUTH_URL}?${params.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<CrmCredentials> {
    const authHeader = Buffer.from(
      `${getPipedriveClientId()}:${getPipedriveClientSecret()}`,
    ).toString('base64');

    const response = await fetch(PIPEDRIVE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error('Pipedrive token exchange failed');
    }

    const tokens = (await response.json()) as PipedriveTokenResponse;

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(
        Date.now() + tokens.expires_in * 1000,
      ).toISOString(),
      api_key: tokens.api_domain, // Store API domain as api_key
    };
  }

  async refreshToken(credentials: CrmCredentials): Promise<CrmCredentials> {
    if (!credentials.refresh_token) {
      throw new Error('No refresh token available');
    }

    const authHeader = Buffer.from(
      `${getPipedriveClientId()}:${getPipedriveClientSecret()}`,
    ).toString('base64');

    const response = await fetch(PIPEDRIVE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${authHeader}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh_token,
      }),
    });

    if (!response.ok) {
      throw new Error('Pipedrive token refresh failed');
    }

    const tokens = (await response.json()) as PipedriveTokenResponse;

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
    const apiDomain = credentials.api_key ?? '';
    let start = 0;

    for (let page = 0; page < 10; page++) {
      let path = `/api/v1/persons?limit=100&start=${start}`;
      if (since) {
        path += `&since_timestamp=${since}`;
      }

      const result = await pipedriveFetch<PipedrivePersonsResponse>(
        apiDomain,
        path,
        credentials.access_token,
      );

      for (const person of result.data ?? []) {
        const primaryEmail = person.email.find((e) => e.primary)?.value ?? person.email[0]?.value ?? null;
        const primaryPhone = person.phone.find((p) => p.primary)?.value ?? person.phone[0]?.value ?? null;

        contacts.push({
          external_id: person.id.toString(),
          email: primaryEmail,
          company_name: person.org_name,
          phone: primaryPhone,
          properties: {
            name: person.name,
            org_name: person.org_name,
          },
          updated_at: person.update_time,
        });
      }

      if (!result.additional_data?.pagination?.more_items_in_collection) break;
      start = result.additional_data.pagination.next_start ?? start + 100;
    }

    return contacts;
  }

  async pushContact(
    credentials: CrmCredentials,
    lead: Record<string, string | null>,
    fieldMapping: Record<string, string>,
    externalId?: string,
  ): Promise<{ external_id: string }> {
    const apiDomain = credentials.api_key ?? '';
    const body: Record<string, unknown> = {};

    for (const [appField, crmField] of Object.entries(fieldMapping)) {
      const value = lead[appField];
      if (value !== null && value !== undefined) {
        if (crmField === 'email') {
          body.email = [{ value, primary: true }];
        } else if (crmField === 'phone') {
          body.phone = [{ value, primary: true }];
        } else {
          body[crmField] = value;
        }
      }
    }

    if (externalId) {
      await pipedriveFetch<PipedriveCreateResponse>(
        apiDomain,
        `/api/v1/persons/${externalId}`,
        credentials.access_token,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      return { external_id: externalId };
    }

    const result = await pipedriveFetch<PipedriveCreateResponse>(
      apiDomain,
      '/api/v1/persons',
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return { external_id: result.data.id.toString() };
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
    const apiDomain = credentials.api_key ?? '';

    const result = await pipedriveFetch<PipedriveCreateResponse>(
      apiDomain,
      '/api/v1/activities',
      credentials.access_token,
      {
        method: 'POST',
        body: JSON.stringify({
          subject: activity.subject,
          note: activity.body,
          type: activity.type === 'email' ? 'email' : 'task',
          person_id: parseInt(activity.contact_external_id, 10),
          due_date: activity.timestamp.split('T')[0],
          done: 1,
        }),
      },
    );

    return { external_id: result.data.id.toString() };
  }

  async validateConnection(credentials: CrmCredentials): Promise<boolean> {
    try {
      const apiDomain = credentials.api_key ?? '';
      await pipedriveFetch<{ success: boolean }>(
        apiDomain,
        '/api/v1/users/me',
        credentials.access_token,
      );
      return true;
    } catch {
      return false;
    }
  }

  // --- Pipedrive-specific methods (not part of CRMAdapter interface) ---

  async fetchPipelines(
    credentials: CrmCredentials,
  ): Promise<Array<{ id: number; name: string }>> {
    const apiDomain = credentials.api_key ?? '';
    const result = await pipedriveFetch<PipedrivePipelineResponse>(
      apiDomain,
      '/api/v1/pipelines',
      credentials.access_token,
    );
    return (result.data ?? []).filter((p) => p.active);
  }

  async fetchStages(
    credentials: CrmCredentials,
    pipelineId: number,
  ): Promise<Array<{ id: number; name: string; pipeline_id: number; order_nr: number }>> {
    const apiDomain = credentials.api_key ?? '';
    const result = await pipedriveFetch<PipedriveStageResponse>(
      apiDomain,
      `/api/v1/stages?pipeline_id=${pipelineId}`,
      credentials.access_token,
    );
    return result.data ?? [];
  }

  async pushDeal(
    credentials: CrmCredentials,
    deal: { title: string; person_id: number; pipeline_id: number; stage_id: number },
  ): Promise<{ external_id: string }> {
    const apiDomain = credentials.api_key ?? '';
    const result = await pipedriveFetch<PipedriveDealCreateResponse>(
      apiDomain,
      '/api/v1/deals',
      credentials.access_token,
      {
        method: 'POST',
        body: JSON.stringify({
          title: deal.title,
          person_id: deal.person_id,
          pipeline_id: deal.pipeline_id,
          stage_id: deal.stage_id,
        }),
      },
    );
    return { external_id: result.data.id.toString() };
  }
}
