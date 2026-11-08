import type {
  CRMAdapter,
  CrmContact,
  CrmCredentials,
  CrmFieldOption,
  CrmProvider,
} from '../types/crm';
import { getAppUrl } from '@/lib/utils/app-url';

import { crmFetch } from './crm-http';

const KOMMO_AUTH_URL = 'https://www.kommo.com/oauth';

const KOMMO_CLIENT_ID = process.env.KOMMO_CLIENT_ID ?? '';
const KOMMO_CLIENT_SECRET = process.env.KOMMO_CLIENT_SECRET ?? '';

/**
 * Kommo's built-in "Venda ganha" status. Every pipeline in Kommo ships with two
 * system statuses: 142 = won ("Venda ganha") and 143 = lost ("Venda perdida").
 * Used to move a deal to the won column when the lead is marked "Ganho".
 */
export const KOMMO_WON_STATUS_ID = 142;

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
  values: Array<{ value: string; enum_code?: string; enum_id?: number }>;
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

interface KommoFieldDefsResult {
  types: Map<string, string>;
  enums: Map<string, Array<{ id: number; value: string }>>;
}

const ENUM_FIELD_TYPES = new Set(['select', 'multiselect', 'radiobutton', 'category']);

/**
 * Resolve a text value to an enum_id for select-type fields.
 * Returns the enum_id if found, or null if no match (field will be skipped).
 */
function resolveEnumId(
  enums: Map<string, Array<{ id: number; value: string }>>,
  fieldKey: string,
  textValue: string,
): number | null {
  const options = enums.get(fieldKey);
  if (!options) return null;
  const normalized = textValue.trim().toLowerCase();
  const match = options.find((o) => o.value.trim().toLowerCase() === normalized);
  return match?.id ?? null;
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
  return crmFetch<T>(`${kommoBaseUrl(subdomain).origin}/api/v4${path}`, {
    ...options,
    label: 'Kommo',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
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
const KOMMO_SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Valida e normaliza o subdomínio Kommo. Aceita "conta" ou "conta.kommo.com"
 * (ou amocrm.com); qualquer outra coisa (pontos, barras, "?", "@", ":") é rejeitada
 * para que o host do token nunca possa ser controlado por quem chama o callback.
 */
export function parseKommoSubdomain(raw: string): string {
  const candidate = raw
    .trim()
    .toLowerCase()
    .replace(/\.kommo\.com$/, '')
    .replace(/\.amocrm\.com$/, '');
  if (!KOMMO_SUBDOMAIN_RE.test(candidate)) {
    throw new Error('Subdomínio Kommo inválido');
  }
  return candidate;
}

function kommoBaseUrl(subdomain: string): URL {
  const clean = parseKommoSubdomain(subdomain);
  const url = new URL(`https://${clean}.kommo.com`);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.kommo.com')) {
    throw new Error('Subdomínio Kommo inválido');
  }
  return url;
}

export class KommoAdapter implements CRMAdapter {
  readonly provider: CrmProvider = 'kommo';

  getAuthUrl(redirectUri: string, state?: string): string {
    const params = new URLSearchParams({
      client_id: KOMMO_CLIENT_ID,
      redirect_uri: redirectUri,
      state: state ?? crypto.randomUUID(),
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

    const cleanSubdomain = parseKommoSubdomain(subdomain);
    const tokenUrl = `${kommoBaseUrl(cleanSubdomain).origin}/oauth2/access_token`;

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
      `${kommoBaseUrl(subdomain).origin}/oauth2/access_token`,
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

    // Fetch contact field definitions (types + enum options) to properly handle select fields
    let contactFieldDefs: KommoFieldDefsResult = { types: new Map(), enums: new Map() };
    try {
      contactFieldDefs = await this.getFieldDefinitions(credentials, 'contacts');
    } catch {
      // If we can't fetch field defs, proceed without enum resolution
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
        const fieldType = contactFieldDefs.types.get(crmField);
        const isNumericId = /^\d+$/.test(crmField);

        if (fieldType && ENUM_FIELD_TYPES.has(fieldType)) {
          // Select/enum field — resolve text value to enum_id
          const enumId = resolveEnumId(contactFieldDefs.enums, crmField, value);
          if (!enumId) continue; // No matching enum option, skip
          customFields.push({
            field_id: isNumericId ? parseInt(crmField, 10) : 0,
            field_name: isNumericId ? '' : crmField,
            field_code: isNumericId ? '' : crmField,
            values: [{ value: enumId.toString(), enum_id: enumId } as { value: string; enum_code?: string }],
          });
        } else {
          // Text/numeric/date field — send value directly
          customFields.push({
            field_id: isNumericId ? parseInt(crmField, 10) : 0,
            field_name: isNumericId ? '' : crmField,
            field_code: isNumericId ? '' : crmField,
            values: [{ value }],
          });
        }
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

    const result = await kommoFetch<
      KommoListResponse<{ id: number; name: string; sort: number; is_archive?: boolean }>
    >(subdomain, '/leads/pipelines', credentials.access_token);

    // Excluir um funil que tem leads no Kommo o ARQUIVA em vez de apagar, e a API
    // segue devolvendo o arquivado (campo `is_archive`). Sem este filtro, o seletor
    // de "enviar ao CRM" oferecia como destino funis que o time não usa mais.
    return (result._embedded?.pipelines ?? [])
      .filter((p) => p.is_archive !== true)
      .map((p) => ({
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
   * Move an existing deal to a given pipeline status — used to reflect the
   * "Ganho" (won) event, moving the deal into Kommo's "Venda ganha" column.
   *
   * Kommo requires pipeline_id alongside status_id when changing a deal's stage,
   * so we always send both. Idempotent: re-sending the same status is a no-op.
   */
  async updateDealStatus(
    credentials: CrmCredentials,
    dealExternalId: string,
    pipelineId: number,
    statusId: number,
  ): Promise<void> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    await kommoFetch<unknown>(
      subdomain,
      `/leads/${dealExternalId}`,
      credentials.access_token,
      {
        method: 'PATCH',
        body: JSON.stringify({ pipeline_id: pipelineId, status_id: statusId }),
      },
    );
  }

  /**
   * Read a deal's current core fields from Kommo. Returns null if the deal does
   * not exist (404 / "Lead not found"). Used by the baseline-restore to compare
   * current state against the target before patching (idempotency).
   */
  async getDealFull(
    credentials: CrmCredentials,
    dealExternalId: string,
  ): Promise<{ statusId: number; pipelineId: number; lossReasonId: number | null; closedAt: number | null } | null> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');
    interface KommoLead {
      status_id?: number;
      pipeline_id?: number;
      loss_reason_id?: number | null;
      closed_at?: number | null;
    }
    try {
      const r = await kommoFetch<KommoLead>(subdomain, `/leads/${dealExternalId}`, credentials.access_token, {
        method: 'GET',
      });
      return {
        statusId: r.status_id ?? 0,
        pipelineId: r.pipeline_id ?? 0,
        lossReasonId: r.loss_reason_id ?? null,
        closedAt: r.closed_at ?? null,
      };
    } catch (err) {
      if (err instanceof Error && (/\(404\)/.test(err.message) || /lead not found/i.test(err.message))) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Restore a deal to a target status, including loss metadata when moving to the
   * "Venda perdida" status (143). Kommo sets a deal's loss_reason via the same
   * update that moves it to 143. `closed_at` is best-effort (Kommo may treat it
   * as read-only and re-stamp it) — sent when provided so we at least try to
   * preserve the original loss date.
   */
  async updateDealFull(
    credentials: CrmCredentials,
    dealExternalId: string,
    target: { pipelineId: number; statusId: number; lossReasonId?: number | null; closedAt?: number | null },
  ): Promise<void> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');
    const body: Record<string, unknown> = {
      pipeline_id: target.pipelineId,
      status_id: target.statusId,
    };
    if (target.lossReasonId != null) body.loss_reason_id = target.lossReasonId;
    if (target.closedAt != null) body.closed_at = target.closedAt;
    await kommoFetch<unknown>(subdomain, `/leads/${dealExternalId}`, credentials.access_token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  /**
   * Delete a deal in Kommo. Used ONLY to remove deals the backfill wrongly
   * recreated (they did not exist at the restore baseline). Caller MUST guard the
   * id against the known recreated-list — never delete a real deal.
   */
  async deleteDeal(credentials: CrmCredentials, dealExternalId: string): Promise<void> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');
    // Kommo v4 deleta via DELETE na COLEÇÃO /leads com corpo [{id}] (não por id
    // na URL — isso retorna 405). Deletamos um por vez para manter o guard.
    await kommoFetch<unknown>(subdomain, `/leads`, credentials.access_token, {
      method: 'DELETE',
      body: JSON.stringify([{ id: parseInt(dealExternalId, 10) }]),
    });
  }

  /**
   * Read a deal's status-change history from Kommo's events log. Each entry is a
   * `lead_status_changed` event with the status id before/after and its unix
   * timestamp. Used to reverse-engineer exactly which stage a deal sat in before
   * a given move (revert) — Kommo is the source of truth for stage history.
   *
   * Returns [] if the deal has no history or was deleted (404 / "Lead not found").
   */
  async getStatusChangeEvents(
    credentials: CrmCredentials,
    dealExternalId: string,
  ): Promise<Array<{ before: number | null; after: number | null; createdAt: number }>> {
    const subdomain = credentials.subdomain;
    if (!subdomain) throw new Error('Kommo subdomain missing');

    interface KommoEvent {
      created_at?: number;
      value_after?: Array<{ lead_status?: { id?: number } }>;
      value_before?: Array<{ lead_status?: { id?: number } }>;
    }
    interface KommoEventsResponse {
      _embedded?: { events?: KommoEvent[] };
    }

    let res: KommoEventsResponse;
    try {
      res = await kommoFetch<KommoEventsResponse>(
        subdomain,
        `/events?filter[entity]=lead&filter[entity_id][]=${dealExternalId}&filter[type]=lead_status_changed&limit=100`,
        credentials.access_token,
        { method: 'GET' },
      );
    } catch (err) {
      if (err instanceof Error && (/\(404\)/.test(err.message) || /lead not found/i.test(err.message))) {
        return [];
      }
      throw err;
    }

    const events = res._embedded?.events ?? [];
    return events
      .map((e) => ({
        before: e.value_before?.[0]?.lead_status?.id ?? null,
        after: e.value_after?.[0]?.lead_status?.id ?? null,
        createdAt: e.created_at ?? 0,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Fetch custom field definitions for an entity (leads or contacts).
   * Returns field type info and enum options for select/multiselect fields.
   */
  async getFieldDefinitions(
    credentials: CrmCredentials,
    entity: 'leads' | 'contacts' = 'leads',
  ): Promise<KommoFieldDefsResult> {
    const subdomain = credentials.subdomain;
    if (!subdomain) return { types: new Map(), enums: new Map() };

    type KommoFieldDef = {
      id: number;
      name: string;
      type: string;
      code: string | null;
      enums?: Array<{ id: number; value: string; sort: number }>;
    };
    try {
      const result = await kommoFetch<KommoListResponse<KommoFieldDef>>(
        subdomain,
        `/${entity}/custom_fields?limit=250`,
        credentials.access_token,
      );
      const fields = result._embedded?.custom_fields ?? [];
      const types = new Map<string, string>();
      const enums = new Map<string, Array<{ id: number; value: string }>>();

      for (const f of fields) {
        const key = f.id.toString();
        types.set(key, f.type);
        if (f.code) types.set(f.code, f.type);

        // Store enum options for select-type fields
        if (f.enums?.length) {
          const options = f.enums.map((e) => ({ id: e.id, value: e.value }));
          enums.set(key, options);
          if (f.code) enums.set(f.code, options);
        }
      }
      return { types, enums };
    } catch (err) {
      console.warn(`[kommo] Failed to fetch ${entity} field definitions:`, err);
      return { types: new Map(), enums: new Map() };
    }
  }

  /** @deprecated Use getFieldDefinitions instead */
  async getLeadFieldTypes(
    credentials: CrmCredentials,
  ): Promise<Map<string, string>> {
    const result = await this.getFieldDefinitions(credentials, 'leads');
    return result.types;
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
