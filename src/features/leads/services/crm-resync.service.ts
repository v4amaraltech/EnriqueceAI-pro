import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { KommoAdapter } from '@/features/integrations/services/kommo.adapter';
import { ensureFreshCredentials } from '@/features/integrations/services/crm-token';
import { DEFAULT_FIELD_MAPPINGS } from '@/features/integrations/types/crm';
import type { CrmConnectionRow } from '@/features/integrations/types/crm';

export type ResyncErrorCode =
  | 'invalid_lead_id'
  | 'lead_not_found'
  | 'no_kommo_connection'
  | 'no_subdomain'
  | 'no_synced_contact'
  | 'no_deal';

export interface ResyncResult {
  success: boolean;
  dealId: number | null;
  fieldsTotal: number;
  succeeded: string[];
  failed: string[];
  errorCode?: ResyncErrorCode;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Re-apply the current crm_connections.field_mapping to an existing Kommo deal.
 * Used when the user edits the mapping after a lead was already pushed —
 * pushLeadToCrm doesn't retroactively update existing deals, so a manual
 * resync is needed.
 *
 * Idempotent: only patches the existing deal's custom_fields_values; doesn't
 * create new contacts/deals. If a deal exists in Kommo for the lead's
 * crm_synced contact but no crm_deal_created interaction is recorded, this
 * function backfills the interaction (legacy data).
 */
export async function resyncCrmDealFields(leadId: string): Promise<ResyncResult> {
  if (!leadId || !UUID_RE.test(leadId)) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'invalid_lead_id' };
  }

  const supabase = createServiceRoleClient();

  const { data: lead } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .single()) as { data: Record<string, string | null> | null };

  const orgId = lead?.org_id as string | undefined;

  const { data: connection } = orgId
    ? ((await from(supabase, 'crm_connections')
        .select('*')
        .eq('org_id', orgId)
        .eq('crm_provider', 'kommo')
        .eq('status', 'connected')
        .single()) as { data: CrmConnectionRow | null })
    : { data: null };

  if (!lead) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'lead_not_found' };
  }
  if (!connection) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'no_kommo_connection' };
  }

  const adapter = new KommoAdapter();
  const credentials = await ensureFreshCredentials(connection, adapter, supabase);
  const subdomain = credentials.subdomain;
  if (!subdomain) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'no_subdomain' };
  }

  const { data: contactSync } = (await from(supabase, 'interactions')
    .select('external_id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_synced')
    .maybeSingle()) as { data: { external_id: string } | null };

  if (!contactSync?.external_id) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'no_synced_contact' };
  }

  // Look up the deal by following contact → deal links in Kommo
  const searchRes = await fetch(
    `https://${subdomain}.kommo.com/api/v4/contacts/${contactSync.external_id}/links`,
    { headers: { Authorization: `Bearer ${credentials.access_token}` } },
  );

  let dealId: number | null = null;
  if (searchRes.ok) {
    const linksData = (await searchRes.json()) as {
      _embedded?: { links?: Array<{ to_entity_id: number; to_entity_type: string }> };
    };
    const dealLink = linksData._embedded?.links?.find((l) => l.to_entity_type === 'leads');
    dealId = dealLink?.to_entity_id ?? null;
  }

  if (!dealId) {
    return { success: false, dealId: null, fieldsTotal: 0, succeeded: [], failed: [], errorCode: 'no_deal' };
  }

  const fieldMapping = connection.field_mapping?.leads ?? DEFAULT_FIELD_MAPPINGS.kommo.leads;
  const KOMMO_CONTACT_FIELDS = new Set([
    'first_name', 'last_name', 'name', 'company_name', 'position', 'EMAIL', 'PHONE',
  ]);
  const ENUM_FIELD_TYPES = new Set(['select', 'multiselect', 'radiobutton', 'category']);

  // Resolve currency cents → reais and flatten custom_field_values
  const flatLead: Record<string, string | null> = { ...lead };
  const cfValues = lead.custom_field_values as unknown as Record<string, string> | null;
  if (cfValues && typeof cfValues === 'object') {
    const { data: currencyFields } = (await from(supabase, 'custom_fields')
      .select('id')
      .eq('org_id', orgId)
      .eq('field_type', 'currency')) as { data: Array<{ id: string }> | null };
    const currencyIds = new Set((currencyFields ?? []).map((f) => f.id));

    for (const [cfId, cfVal] of Object.entries(cfValues)) {
      let value = typeof cfVal === 'string' ? cfVal : String(cfVal ?? '');
      if (currencyIds.has(cfId) && value) {
        const numVal = Number(value);
        if (!isNaN(numVal)) value = String(numVal / 100);
      }
      flatLead[`custom_${cfId}`] = value;
    }
  }

  if (lead.assigned_to) {
    const { data: authUser } = await supabase.auth.admin.getUserById(lead.assigned_to as string);
    flatLead.assigned_to_name = authUser?.user?.user_metadata?.name ?? authUser?.user?.email ?? null;
  }

  const fieldDefs = await adapter.getFieldDefinitions(credentials, 'leads');

  const customFieldsValues: Array<{
    field_id?: number;
    field_code?: string;
    values: Array<{ value: string; enum_id?: number }>;
  }> = [];

  for (const [appField, crmField] of Object.entries(fieldMapping)) {
    if (KOMMO_CONTACT_FIELDS.has(crmField)) continue;

    const value = flatLead[appField];
    if (!value) continue;

    const fieldType = fieldDefs.types.get(crmField);
    const numericId = parseInt(crmField, 10);
    const isNumeric = !isNaN(numericId) && crmField === numericId.toString();

    if (fieldType && ENUM_FIELD_TYPES.has(fieldType)) {
      const options = fieldDefs.enums.get(crmField);
      if (!options) continue;
      const normalized = value.trim().toLowerCase();
      const match = options.find((o) => o.value.trim().toLowerCase() === normalized);
      if (!match) continue;

      if (isNumeric) {
        customFieldsValues.push({ field_id: numericId, values: [{ value: match.value, enum_id: match.id }] });
      } else {
        customFieldsValues.push({ field_code: crmField, values: [{ value: match.value, enum_id: match.id }] });
      }
    } else {
      let formatted = value;
      if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
        const date = new Date(value);
        if (!isNaN(date.getTime())) {
          formatted = date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
        }
      }
      if (isNumeric) {
        customFieldsValues.push({ field_id: numericId, values: [{ value: formatted }] });
      } else {
        customFieldsValues.push({ field_code: crmField, values: [{ value: formatted }] });
      }
    }
  }

  const kommoHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${credentials.access_token}`,
  };
  const dealUrl = `https://${subdomain}.kommo.com/api/v4/leads/${dealId}`;

  const patchRes = await fetch(dealUrl, {
    method: 'PATCH',
    headers: kommoHeaders,
    body: JSON.stringify({ custom_fields_values: customFieldsValues }),
  });

  const succeeded: string[] = [];
  const failed: string[] = [];

  if (!patchRes.ok) {
    // Batch failed — try each field individually to isolate the bad ones
    for (const field of customFieldsValues) {
      const fieldKey = 'field_id' in field ? `id:${field.field_id}` : `code:${field.field_code}`;
      try {
        const singleRes = await fetch(dealUrl, {
          method: 'PATCH',
          headers: kommoHeaders,
          body: JSON.stringify({ custom_fields_values: [field] }),
        });
        if (singleRes.ok) {
          succeeded.push(fieldKey);
        } else {
          const errText = await singleRes.text();
          console.warn(`[crm-resync] Field ${fieldKey} failed (${singleRes.status}):`, errText.slice(0, 200));
          failed.push(fieldKey);
        }
      } catch {
        failed.push(fieldKey);
      }
    }
  } else {
    succeeded.push(`all ${customFieldsValues.length} fields`);
  }

  // Backfill crm_deal_created interaction if missing (legacy leads pushed before
  // this interaction type existed).
  const { data: existingDeal } = (await from(supabase, 'interactions')
    .select('id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_deal_created')
    .maybeSingle()) as { data: { id: string } | null };

  if (!existingDeal && orgId) {
    await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'crm',
      type: 'crm_deal_created',
      external_id: dealId.toString(),
      metadata: { crm_provider: 'kommo', resync: true },
    } as Record<string, unknown>);
  }

  return {
    success: succeeded.length > 0,
    dealId,
    fieldsTotal: customFieldsValues.length,
    succeeded,
    failed,
  };
}
