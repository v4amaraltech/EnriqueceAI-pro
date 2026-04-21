import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmFieldOption,
  CrmProvider,
} from '../types/crm';
import { getAppUrl } from '@/lib/utils/app-url';

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
          redirect_uri: `${getAppUrl()}/api/auth/callback/kommo`,
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

  async listFields(credentials: CrmCredentials): Promise<CrmFieldOption[]> {
    if (!credentials.subdomain) throw new Error('Kommo subdomain missing');
    const sub: string = credentials.subdomain;

    const standard: CrmFieldOption[] = [
      { value: 'first_name', label: 'Nome', isCustom: false },
      { value: 'last_name', label: 'Sobrenome', isCustom: false },
      { value: 'name', label: 'Nome Completo', isCustom: false },
      { value: 'company_name', label: 'Empresa', isCustom: false },
      { value: 'position', label: 'Cargo', isCustom: false },
      { value: 'EMAIL', label: 'Email', isCustom: false },
      { value: 'PHONE', label: 'Telefone', isCustom: false },
    ];

    type KommoFieldDef = { id: number; name: string; type: string; code: string | null };
    const accessToken = credentials.access_token;

    async function fetchCustomFields(entity: 'contacts' | 'leads'): Promise<CrmFieldOption[]> {
      try {
        const result = await kommoFetch<KommoListResponse<KommoFieldDef>>(
          sub,
          `/${entity}/custom_fields?limit=250`,
          accessToken,
        );
        const fields = result._embedded?.custom_fields ?? [];
        return fields
          .filter((f) => f.code !== 'EMAIL' && f.code !== 'PHONE')
          .map((f) => ({
            value: f.code ?? f.id.toString(),
            label: f.name,
            type: f.type,
            isCustom: true,
          }));
      } catch (err) {
        console.warn(`[kommo] Failed to fetch ${entity} custom fields:`, err);
        return [];
      }
    }

    const [contactFields, leadFields] = await Promise.all([
      fetchCustomFields('contacts'),
      fetchCustomFields('leads'),
    ]);

    // Deduplicate by value (contact fields take priority)
    const seen = new Set<string>();
    const allCustom: CrmFieldOption[] = [];
    for (const f of [...contactFields, ...leadFields]) {
      if (!seen.has(f.value)) {
        seen.add(f.value);
        allCustom.push(f);
      }
    }

    return [...standard, ...allCustom].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
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

    // Fetch contact field types to skip select/enum fields (they require enum_id, not text value)
    const ENUM_FIELD_TYPES = new Set(['select', 'multiselect', 'radiobutton', 'category']);
    let contactFieldTypes = new Map<string, string>();
    try {
      type KommoFieldDef = { id: number; name: string; type: string; code: string | null };
      const result = await kommoFetch<KommoListResponse<KommoFieldDef>>(
        subdomain,
        '/contacts/custom_fields?limit=250',
        credentials.access_token,
      );
      const fields = result._embedded?.custom_fields ?? [];
      for (const f of fields) {
        contactFieldTypes.set(f.id.toString(), f.type);
        if (f.code) contactFieldTypes.set(f.code, f.type);
      }
    } catch {
      // If we can't fetch field types, proceed without filtering
    }

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
      } else {
        // Skip select/enum fields — they require enum_id which we don't have
        const fieldType = contactFieldTypes.get(crmField);
        if (fieldType && ENUM_FIELD_TYPES.has(fieldType)) {
          continue;
        }

        // Generic custom field — use field_id if numeric, field_name otherwise
        const isNumericId = /^\d+$/.test(crmField);
        customFields.push({
          field_id: isNumericId ? parseInt(crmField, 10) : 0,
          field_name: isNumericId ? '' : crmField,
          field_code: isNumericId ? '' : crmField,
          values: [{ value }],
        });
      }
    }

    // Build contact name
    const firstName = lead[Object.keys(fieldMapping).find((k) => fieldMapping[k] === 'first_name') ?? ''];
    const lastName = lead[Object.keys(fieldMapping).find((k) => fieldMapping[k] === 'last_name') ?? ''];
    contactName = [firstName, lastName].filter(Boolean).join(' ') || lead.nome_fantasia || 'Contato';

    // Build clean custom fields payload — use field_id for numeric IDs, field_code for standard fields
    const cleanCustomFields = customFields.map((f) => {
      if (f.field_id > 0) {
        return { field_id: f.field_id, values: f.values };
      }
      return { field_code: f.field_code, values: f.values };
    });

    if (externalId) {
      // Update existing contact — send standard fields first, then extras (best-effort)
      const stdFields = cleanCustomFields.filter((f) => 'field_code' in f && (f.field_code === 'PHONE' || f.field_code === 'EMAIL'));
      const extFields = cleanCustomFields.filter((f) => !('field_code' in f) || (f.field_code !== 'PHONE' && f.field_code !== 'EMAIL'));

      await kommoFetch<unknown>(
        subdomain,
        `/contacts/${externalId}`,
        credentials.access_token,
        { method: 'PATCH', body: JSON.stringify({ name: contactName, custom_fields_values: stdFields }) },
      );

      if (extFields.length > 0) {
        try {
          await kommoFetch<unknown>(
            subdomain,
            `/contacts/${externalId}`,
            credentials.access_token,
            { method: 'PATCH', body: JSON.stringify({ custom_fields_values: extFields }) },
          );
        } catch (cfErr) {
          console.warn('[kommo] Failed to update custom fields (non-blocking):', cfErr);
        }
      }

      return { external_id: externalId };
    }

    // Create contact via POST /contacts
    const companyNameField = Object.keys(fieldMapping).find(
      (k) => fieldMapping[k] === 'company_name',
    );
    const companyName = companyNameField ? lead[companyNameField] : null;

    // Only standard fields (PHONE, EMAIL) for initial contact creation — custom fields can fail
    const standardFields = cleanCustomFields.filter((f) => 'field_code' in f && (f.field_code === 'PHONE' || f.field_code === 'EMAIL'));
    const extraFields = cleanCustomFields.filter((f) => !('field_code' in f) || (f.field_code !== 'PHONE' && f.field_code !== 'EMAIL'));

    const contactPayload = [
      {
        name: contactName,
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        custom_fields_values: standardFields,
        ...(companyName
          ? { _embedded: { companies: [{ name: companyName }] } }
          : {}),
      },
    ];

    const result = await kommoFetch<KommoCreateResponse>(
      subdomain,
      '/contacts',
      credentials.access_token,
      { method: 'POST', body: JSON.stringify(contactPayload) },
    );

    const createdId = result._embedded?.contacts?.[0]?.id;
    if (!createdId) {
      console.error('[kommo] POST /contacts unexpected response:', JSON.stringify(result));
      throw new Error('Kommo: failed to create contact, no ID returned');
    }

    // Try to add extra custom fields (best-effort — don't fail if Kommo rejects)
    if (extraFields.length > 0) {
      try {
        await kommoFetch<unknown>(
          subdomain,
          `/contacts/${createdId}`,
          credentials.access_token,
          { method: 'PATCH', body: JSON.stringify({ custom_fields_values: extraFields }) },
        );
      } catch (cfErr) {
        console.warn('[kommo] Failed to set custom fields on contact (non-blocking):', cfErr);
      }
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

  async fetchUsers(
    credentials: CrmCredentials,
  ): Promise<Array<{ id: number; name: string; email: string }>> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    const result = await kommoFetch<KommoListResponse<{ id: number; name: string; email: string }>>(
      subdomain,
      '/users',
      credentials.access_token,
    );

    return (result._embedded?.users ?? []).map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
    }));
  }

  async pushDeal(
    credentials: CrmCredentials,
    options: {
      title: string;
      contactExternalId: string;
      pipelineId: number;
      stageId: number;
      responsibleUserId?: number;
      customFieldsValues?: Array<{
        field_id?: number;
        field_code?: string;
        values: Array<{ value: string }>;
      }>;
    },
  ): Promise<{ external_id: string }> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    // Step 1: Create deal with basic info only (no custom fields — they can cause NotSupportedChoice errors)
    const payload = [
      {
        name: options.title,
        pipeline_id: options.pipelineId,
        status_id: options.stageId,
        ...(options.responsibleUserId ? { responsible_user_id: options.responsibleUserId } : {}),
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

    // Step 2: Add custom fields via PATCH (best-effort — don't fail deal creation)
    if (options.customFieldsValues?.length) {
      try {
        await kommoFetch<unknown>(
          subdomain,
          `/leads/${createdId}`,
          credentials.access_token,
          { method: 'PATCH', body: JSON.stringify({ custom_fields_values: options.customFieldsValues }) },
        );
      } catch (cfErr) {
        console.warn('[kommo] Failed to set custom fields on deal (non-blocking):', cfErr);
      }
    }

    return { external_id: createdId.toString() };
  }

  /**
   * Fetch lead (deal) custom field definitions to determine field types.
   * Fields of type select/multiselect/radiobutton/category require enum_id
   * instead of a plain text value — callers should skip those fields.
   */
  async getLeadFieldTypes(
    credentials: CrmCredentials,
  ): Promise<Map<string, string>> {
    const subdomain = credentials.subdomain;
    if (!subdomain) return new Map();

    type KommoFieldDef = { id: number; name: string; type: string; code: string | null };
    try {
      const result = await kommoFetch<KommoListResponse<KommoFieldDef>>(
        subdomain,
        '/leads/custom_fields?limit=250',
        credentials.access_token,
      );
      const fields = result._embedded?.custom_fields ?? [];
      const map = new Map<string, string>();
      for (const f of fields) {
        // Map both numeric ID and code to type
        map.set(f.id.toString(), f.type);
        if (f.code) map.set(f.code, f.type);
      }
      return map;
    } catch (err) {
      console.warn('[kommo] Failed to fetch lead field types:', err);
      return new Map();
    }
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
