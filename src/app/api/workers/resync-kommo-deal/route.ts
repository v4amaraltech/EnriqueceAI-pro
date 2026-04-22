'use server';

import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { KommoAdapter } from '@/features/integrations/services/kommo.adapter';
import { ensureFreshCredentials } from '@/features/integrations/services/crm-token';
import { DEFAULT_FIELD_MAPPINGS } from '@/features/integrations/types/crm';
import type { CrmConnectionRow } from '@/features/integrations/types/crm';

/**
 * Temporary worker to resync custom fields for existing Kommo deals.
 * POST /api/workers/resync-kommo-deal
 * Body: { leadId: string }
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { leadId } = (await request.json()) as { leadId: string };
  if (!leadId) {
    return NextResponse.json({ error: 'leadId required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Get lead data
  const { data: lead } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .single()) as { data: Record<string, string | null> | null };

  if (!lead) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  const orgId = lead.org_id as string;

  // Get Kommo connection
  const { data: connection } = (await from(supabase, 'crm_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('crm_provider', 'kommo')
    .eq('status', 'connected')
    .single()) as { data: CrmConnectionRow | null };

  if (!connection) {
    return NextResponse.json({ error: 'No Kommo connection found' }, { status: 404 });
  }

  const adapter = new KommoAdapter();
  const credentials = await ensureFreshCredentials(connection, adapter, supabase);
  const subdomain = credentials.subdomain;
  if (!subdomain) {
    return NextResponse.json({ error: 'No subdomain' }, { status: 500 });
  }

  // Find the contact external ID
  const { data: contactSync } = (await from(supabase, 'interactions')
    .select('external_id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_synced')
    .maybeSingle()) as { data: { external_id: string } | null };

  if (!contactSync?.external_id) {
    return NextResponse.json({ error: 'No synced contact found' }, { status: 404 });
  }

  // Find the deal in Kommo by searching for deals linked to this contact
  const searchRes = await fetch(
    `https://${subdomain}.kommo.com/api/v4/contacts/${contactSync.external_id}/links`,
    {
      headers: { Authorization: `Bearer ${credentials.access_token}` },
    },
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
    return NextResponse.json({ error: 'No deal found in Kommo for this contact' }, { status: 404 });
  }

  // Build custom fields with enum resolution
  const fieldMapping = connection.field_mapping?.leads ?? DEFAULT_FIELD_MAPPINGS.kommo.leads;
  const KOMMO_CONTACT_FIELDS = new Set([
    'first_name', 'last_name', 'name', 'company_name', 'position', 'EMAIL', 'PHONE',
  ]);
  const ENUM_FIELD_TYPES = new Set(['select', 'multiselect', 'radiobutton', 'category']);

  // Build flatLead with custom fields
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

  // Resolve assigned_to name
  if (lead.assigned_to) {
    const { data: authUser } = await supabase.auth.admin.getUserById(lead.assigned_to as string);
    flatLead.assigned_to_name = authUser?.user?.user_metadata?.name ?? authUser?.user?.email ?? null;
  }

  // Get field definitions with enum options
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
      // Format dates for Kommo
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

  // PATCH the deal with custom fields
  const patchRes = await fetch(
    `https://${subdomain}.kommo.com/api/v4/leads/${dealId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({ custom_fields_values: customFieldsValues }),
    },
  );

  const patchBody = await patchRes.text();

  // Record crm_deal_created if missing
  const { data: existingDeal } = (await from(supabase, 'interactions')
    .select('id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_deal_created')
    .maybeSingle()) as { data: { id: string } | null };

  if (!existingDeal) {
    await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'crm',
      type: 'crm_deal_created',
      external_id: dealId.toString(),
      metadata: { crm_provider: 'kommo', resync: true },
    } as Record<string, unknown>);
  }

  return NextResponse.json({
    success: patchRes.ok,
    dealId,
    fieldsCount: customFieldsValues.length,
    kommoStatus: patchRes.status,
    kommoResponse: patchBody.slice(0, 500),
  });
}
