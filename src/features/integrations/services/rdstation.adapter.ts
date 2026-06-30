import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmFieldOption,
  CrmProvider,
} from '../types/crm';

const RD_CRM_BASE = 'https://crm.rdstation.com/api/v1';

interface RdCrmContactResponse {
  id: string;
  name: string;
  emails?: Array<{ email: string }>;
  phones?: Array<{ phone: string }>;
  organization?: { id: string; name: string } | null;
  updated_at: string;
  custom_fields?: Record<string, unknown>;
}

interface RdCrmContactListResponse {
  contacts: RdCrmContactResponse[];
  has_more: boolean;
  total: number;
}

interface RdCrmOrganizationResponse {
  id: string;
  name: string;
}

interface RdCrmDealResponse {
  id: string;
  name: string;
}

interface RdCrmPipelineResponse {
  id: string;
  name: string;
}

interface RdCrmStageResponse {
  id: string;
  name: string;
  nickname: string;
  order: number;
}

async function rdCrmFetch<T>(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${RD_CRM_BASE}${path}${separator}token=${token}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    // Timeout de 15s (alinhado aos outros adapters) — endpoint RD lento não pode
    // pendurar o cron de sync indefinidamente.
    signal: options.signal ?? AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`RD Station CRM API error (${response.status}): ${errorText}`);
  }

  return (await response.json()) as T;
}

export class RDStationAdapter implements CRMAdapter {
  readonly provider: CrmProvider = 'rdstation';

  getAuthUrl(_redirectUri: string): string {
    // RD Station CRM uses API token, not OAuth
    return '';
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<CrmCredentials> {
    throw new Error('RD Station CRM uses API token authentication, not OAuth');
  }

  async refreshToken(credentials: CrmCredentials): Promise<CrmCredentials> {
    // API token does not expire — return as-is
    return credentials;
  }

  async listFields(credentials: CrmCredentials): Promise<CrmFieldOption[]> {
    const token = credentials.api_key ?? credentials.access_token;
    const standard: CrmFieldOption[] = [
      { value: 'email', label: 'Email', isCustom: false },
      { value: 'phone', label: 'Telefone', isCustom: false },
      { value: 'mobile_phone', label: 'Celular', isCustom: false },
      { value: 'name', label: 'Nome', isCustom: false },
      { value: 'title', label: 'Cargo', isCustom: false },
    ];
    let custom: CrmFieldOption[] = [];
    try {
      const result = await rdCrmFetch<
        Array<{ id: string; label: string; field_type: string }>
      >('/contacts/custom_fields', token);
      custom = result.map((f) => ({
        value: `cf_${f.id}`,
        label: f.label,
        type: f.field_type,
        isCustom: true,
      }));
    } catch {
      /* fallback sem custom */
    }
    return [...standard, ...custom].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }

  async validateConnection(credentials: CrmCredentials): Promise<boolean> {
    try {
      await rdCrmFetch<RdCrmPipelineResponse[]>(
        '/deal_pipelines?limit=1',
        credentials.api_key ?? credentials.access_token,
      );
      return true;
    } catch {
      return false;
    }
  }

  async pullContacts(
    credentials: CrmCredentials,
    _since?: string,
  ): Promise<CrmContact[]> {
    const token = credentials.api_key ?? credentials.access_token;
    const contacts: CrmContact[] = [];

    for (let page = 1; page <= 10; page++) {
      const result = await rdCrmFetch<RdCrmContactListResponse>(
        `/contacts?page=${page}&limit=100`,
        token,
      );

      for (const contact of result.contacts) {
        const primaryEmail = contact.emails?.[0]?.email ?? null;
        const primaryPhone = contact.phones?.[0]?.phone ?? null;

        contacts.push({
          external_id: contact.id,
          email: primaryEmail,
          company_name: contact.organization?.name ?? null,
          phone: primaryPhone,
          properties: {
            name: contact.name,
            company: contact.organization?.name ?? null,
          },
          updated_at: contact.updated_at,
        });
      }

      if (!result.has_more) break;
    }

    return contacts;
  }

  async pushContact(
    credentials: CrmCredentials,
    lead: Record<string, string | null>,
    fieldMapping: Record<string, string>,
    externalId?: string,
  ): Promise<{ external_id: string }> {
    const token = credentials.api_key ?? credentials.access_token;

    // Build contact body from field mapping
    const body: Record<string, unknown> = {};
    const emails: Array<{ email: string }> = [];
    const phones: Array<{ phone: string }> = [];

    for (const [appField, crmField] of Object.entries(fieldMapping)) {
      const value = lead[appField];
      if (value === null || value === undefined) continue;

      if (crmField === 'email') {
        emails.push({ email: value });
      } else if (crmField === 'mobile_phone' || crmField === 'phone') {
        phones.push({ phone: value });
      } else {
        body[crmField] = value;
      }
    }

    if (emails.length > 0) body.emails = emails;
    if (phones.length > 0) body.phones = phones;

    // Build contact name from first_name + last_name, fallback to company name
    if (!body.name) {
      const fullName = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim();
      body.name = fullName || lead.nome_fantasia || lead.razao_social || 'Contato';
    }

    // Ensure name has at least 2 chars (API requirement)
    if (typeof body.name === 'string' && body.name.length < 2) {
      body.name = `${body.name} .`;
    }

    if (externalId) {
      await rdCrmFetch<RdCrmContactResponse>(
        `/contacts/${externalId}`,
        token,
        { method: 'PUT', body: JSON.stringify(body) },
      );
      return { external_id: externalId };
    }

    const result = await rdCrmFetch<RdCrmContactResponse>(
      '/contacts',
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return { external_id: result.id };
  }

  async pushActivity(
    _credentials: CrmCredentials,
    _activity: {
      contact_external_id: string;
      type: string;
      subject: string;
      body: string;
      timestamp: string;
    },
  ): Promise<{ external_id: string }> {
    // RD Station CRM does not have a generic activities API
    return { external_id: `noop_${Date.now()}` };
  }

  // --- RD Station CRM-specific methods ---

  async fetchPipelines(
    credentials: CrmCredentials,
  ): Promise<Array<{ id: string; name: string }>> {
    const token = credentials.api_key ?? credentials.access_token;
    const pipelines = await rdCrmFetch<RdCrmPipelineResponse[]>(
      '/deal_pipelines',
      token,
    );
    return pipelines.map((p) => ({ id: p.id, name: p.name }));
  }

  async fetchStages(
    credentials: CrmCredentials,
    pipelineId: string,
  ): Promise<Array<{ id: string; name: string; order: number }>> {
    const token = credentials.api_key ?? credentials.access_token;
    const response = await rdCrmFetch<{ deal_stages: RdCrmStageResponse[] }>(
      `/deal_stages?deal_pipeline_id=${pipelineId}`,
      token,
    );
    return response.deal_stages.map((s) => ({
      id: s.id,
      name: s.name || s.nickname,
      order: s.order,
    }));
  }

  async pushOrganization(
    credentials: CrmCredentials,
    data: { name: string; address?: string; url?: string; phone?: string },
  ): Promise<{ external_id: string }> {
    const token = credentials.api_key ?? credentials.access_token;

    // Ensure name has at least 2 chars
    let orgName = data.name;
    if (orgName.length < 2) {
      orgName = `${orgName} .`;
    }

    const body: Record<string, unknown> = { name: orgName };
    if (data.address) body.address = data.address;
    if (data.url) body.url = data.url;
    if (data.phone) body.phone = data.phone;

    const result = await rdCrmFetch<RdCrmOrganizationResponse>(
      '/organizations',
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return { external_id: result.id };
  }

  async pushDeal(
    credentials: CrmCredentials,
    data: {
      name: string;
      deal_stage_id: string;
      contacts: string[];
      organization_id?: string;
    },
  ): Promise<{ external_id: string }> {
    const token = credentials.api_key ?? credentials.access_token;

    const body: Record<string, unknown> = {
      name: data.name,
      deal_stage_id: data.deal_stage_id,
      set_contacts: data.contacts.map((id) => ({ _id: id })),
    };

    if (data.organization_id) {
      body.organization = { id: data.organization_id };
    }

    const result = await rdCrmFetch<RdCrmDealResponse>(
      '/deals',
      token,
      { method: 'POST', body: JSON.stringify(body) },
    );

    return { external_id: result.id };
  }
}
