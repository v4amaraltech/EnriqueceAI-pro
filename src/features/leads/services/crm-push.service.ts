import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { CRMRegistry } from '@/features/integrations/services/crm-registry';
import { ensureFreshCredentials } from '@/features/integrations/services/crm-token';
import { HubSpotAdapter } from '@/features/integrations/services/hubspot.adapter';
import { KommoAdapter } from '@/features/integrations/services/kommo.adapter';
import { PipedriveAdapter } from '@/features/integrations/services/pipedrive.adapter';
import { RDStationAdapter } from '@/features/integrations/services/rdstation.adapter';
import type { CrmConnectionRow, CrmProvider } from '@/features/integrations/types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '@/features/integrations/types/crm';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

export interface CrmPushOptions {
  provider: CrmProvider;
  pipelineId: string;
  stageId: string;
  responsibleUserId?: string;
}

export interface CrmPushResult {
  dealCreated: boolean;
  dealExternalId?: string;
  contactExternalId?: string;
  /** Set when push was skipped: 'already_synced' | 'no_connection' | 'unsupported_provider' | error string */
  skippedReason?: string;
}

/** Format date-like values to ISO 8601 with timezone (Kommo rejects bare dates). */
function formatValueForKommo(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    }
  }
  return value;
}

/**
 * Push a lead to its org's CRM (Contact + Deal).
 *
 * Two entry points:
 *  - markLeadAsWon (UI button) passes crmOptions gathered from the form
 *  - /api/feedback (closer feedback) passes crmOptions built from crm_connections defaults
 *
 * Idempotent: if a deal already exists for the lead (crm_deal_created interaction),
 * returns { dealCreated: false, skippedReason: 'already_synced' } without re-pushing.
 */
export async function pushLeadToCrm(
  orgId: string,
  leadId: string,
  crmOptions: CrmPushOptions,
): Promise<CrmPushResult> {
  const supabase = createServiceRoleClient();

  // Dedup: if a deal was already created for this lead, don't push again.
  const { data: existingDeal } = (await from(supabase, 'interactions')
    .select('external_id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_deal_created')
    .maybeSingle()) as { data: { external_id: string } | null };
  if (existingDeal?.external_id) {
    return { dealCreated: false, dealExternalId: existingDeal.external_id, skippedReason: 'already_synced' };
  }

  // Fetch CRM connection
  const { data: connection } = (await from(supabase, 'crm_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('crm_provider', crmOptions.provider)
    .eq('status', 'connected')
    .single()) as { data: CrmConnectionRow | null };

  if (!connection) {
    return { dealCreated: false, skippedReason: 'no_connection' };
  }

  const adapter = CRMRegistry.getAdapter(crmOptions.provider);
  const credentials = await ensureFreshCredentials(connection, adapter, supabase);

  // Fetch lead
  const { data: lead } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .single()) as { data: Record<string, string | null> | null };

  if (!lead) {
    return { dealCreated: false, skippedReason: 'lead_not_found' };
  }

  const fieldMapping = connection.field_mapping?.leads ?? DEFAULT_FIELD_MAPPINGS[crmOptions.provider].leads;

  // Resolve currency custom fields (cents → reais) and flatten custom_field_values
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

  // Resolve assigned_to UUID → name for mapping
  if (lead.assigned_to) {
    const { data: authUser } = await supabase.auth.admin.getUserById(lead.assigned_to as string);
    flatLead.assigned_to_name = authUser?.user?.user_metadata?.name ?? authUser?.user?.email ?? null;
  }

  // Contact dedup
  const { data: existingSync } = (await from(supabase, 'interactions')
    .select('external_id')
    .eq('lead_id', leadId)
    .eq('type', 'crm_synced')
    .maybeSingle()) as { data: { external_id: string } | null };

  let contactExternalId: string | undefined;
  try {
    const pushResult = await adapter.pushContact(
      credentials,
      flatLead,
      fieldMapping,
      existingSync?.external_id ?? undefined,
    );
    contactExternalId = pushResult.external_id;
  } catch (pushErr) {
    console.error('[crm-push] pushContact failed:', pushErr);
  }

  if (contactExternalId && !existingSync) {
    await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'crm',
      type: 'crm_synced',
      external_id: contactExternalId,
    } as Record<string, unknown>);
  }

  const dealTitle = (lead.nome_fantasia ?? lead.razao_social ?? 'Deal') as string;
  let dealExternalId = '';

  if (crmOptions.provider === 'pipedrive') {
    const pipedriveAdapter = adapter as PipedriveAdapter;

    const razao = (lead.razao_social ?? lead.nome_fantasia ?? dealTitle) as string;
    const cnpj = lead.cnpj as string | null;
    const orgName = cnpj ? `${razao} | ${cnpj}` : razao;

    const endereco = lead.endereco as unknown as {
      logradouro?: string; numero?: string; complemento?: string;
      bairro?: string; cidade?: string; uf?: string; cep?: string;
    } | null;
    let orgAddress: string | undefined;
    if (endereco && typeof endereco === 'object') {
      const street = [endereco.logradouro, endereco.numero, endereco.complemento].filter(Boolean).join(', ');
      const locality = [endereco.bairro, endereco.cidade, endereco.uf].filter(Boolean).join(' - ');
      orgAddress = [street, locality, endereco.cep].filter(Boolean).join(', ');
    }

    const orgResult = await pipedriveAdapter.pushOrganization(credentials, {
      name: orgName,
      address: orgAddress,
    });
    const orgExternalId = parseInt(orgResult.external_id, 10);

    await pipedriveAdapter.pushContact(credentials, lead, fieldMapping, contactExternalId);

    const apiDomain = credentials.api_key ?? '';
    await fetch(`${apiDomain || 'https://api.pipedrive.com'}/api/v1/persons/${contactExternalId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.access_token}`,
      },
      body: JSON.stringify({ org_id: orgExternalId }),
    });

    const leadSource = lead.lead_source as string | null;
    let customFields: Record<string, string> | undefined;
    let origemFieldFailed = false;
    if (leadSource) {
      try {
        const origemKey = await pipedriveAdapter.ensureOrigemField(credentials);
        customFields = { [origemKey]: leadSource };
      } catch {
        origemFieldFailed = true;
      }
    }

    const result = await pipedriveAdapter.pushDeal(credentials, {
      title: dealTitle,
      person_id: parseInt(contactExternalId ?? existingSync?.external_id ?? '0', 10),
      pipeline_id: parseInt(crmOptions.pipelineId, 10),
      stage_id: parseInt(crmOptions.stageId, 10),
      org_id: orgExternalId,
      customFields,
    });
    dealExternalId = result.external_id;

    if (leadSource && origemFieldFailed) {
      try {
        await pipedriveAdapter.pushActivity(credentials, {
          contact_external_id: contactExternalId ?? '',
          type: 'note',
          subject: 'Origem do Lead',
          body: `Origem: ${leadSource}`,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // best-effort
      }
    }
  } else if (crmOptions.provider === 'hubspot') {
    const hubspotAdapter = adapter as HubSpotAdapter;
    const hsRazao = (lead.razao_social ?? lead.nome_fantasia ?? dealTitle) as string;
    const hsCnpj = lead.cnpj as string | null;
    const companyName = hsCnpj ? `${hsRazao} | ${hsCnpj}` : hsRazao;
    const endereco = lead.endereco as unknown as {
      logradouro?: string; numero?: string; complemento?: string;
      bairro?: string; cidade?: string; uf?: string; cep?: string;
    } | null;
    let hsAddress: string | undefined;
    let hsCity: string | undefined;
    let hsState: string | undefined;
    let hsZip: string | undefined;
    if (endereco && typeof endereco === 'object') {
      const streetParts = [endereco.logradouro, endereco.numero, endereco.complemento].filter(Boolean);
      hsAddress = streetParts.join(', ') || undefined;
      hsCity = endereco.cidade || undefined;
      hsState = endereco.uf || undefined;
      hsZip = endereco.cep || undefined;
    }

    const companyResult = await hubspotAdapter.pushCompany(credentials, {
      name: companyName,
      address: hsAddress,
      city: hsCity,
      state: hsState,
      zip: hsZip,
      phone: (lead.telefone as string) || undefined,
    });
    const companyId = companyResult.external_id;

    if (contactExternalId) {
      await hubspotAdapter.associateContactToCompany(credentials, contactExternalId, companyId);
    }

    const hsLeadSource = lead.lead_source as string | null;
    let customProperties: Record<string, string> | undefined;
    if (hsLeadSource) {
      try {
        await hubspotAdapter.ensureOrigemProperty(credentials);
        customProperties = { origem: hsLeadSource };
      } catch {
        // scope not granted
      }
    }

    const result = await hubspotAdapter.pushDeal(credentials, {
      title: dealTitle,
      contactId: contactExternalId ?? existingSync?.external_id ?? '',
      pipelineId: crmOptions.pipelineId,
      stageId: crmOptions.stageId,
      companyId,
      customProperties,
    });
    dealExternalId = result.external_id;
  } else if (crmOptions.provider === 'rdstation') {
    const rdAdapter = adapter as RDStationAdapter;
    const rdRazao = (lead.razao_social ?? lead.nome_fantasia ?? dealTitle) as string;
    const rdCnpj = lead.cnpj as string | null;
    const rdOrgName = rdCnpj ? `${rdRazao} | ${rdCnpj}` : rdRazao;

    const rdEndereco = lead.endereco as unknown as {
      logradouro?: string; numero?: string; complemento?: string;
      bairro?: string; cidade?: string; uf?: string; cep?: string;
    } | null;
    let rdAddress: string | undefined;
    if (rdEndereco && typeof rdEndereco === 'object') {
      const street = [rdEndereco.logradouro, rdEndereco.numero, rdEndereco.complemento].filter(Boolean).join(', ');
      const locality = [rdEndereco.bairro, rdEndereco.cidade, rdEndereco.uf].filter(Boolean).join(' - ');
      rdAddress = [street, locality, rdEndereco.cep].filter(Boolean).join(', ') || undefined;
    }

    let organizationId: string | undefined;
    try {
      const orgResult = await rdAdapter.pushOrganization(credentials, {
        name: rdOrgName,
        address: rdAddress,
        phone: (lead.telefone as string) || undefined,
        url: (lead.website as string) || undefined,
      });
      organizationId = orgResult.external_id;
    } catch {
      // org may exist
    }

    if (organizationId) {
      try {
        await rdAdapter.pushContact(
          credentials,
          { ...lead, organization_id: organizationId } as Record<string, string | null>,
          fieldMapping,
          contactExternalId,
        );
      } catch {
        // best-effort
      }
    }

    const rdDealResult = await rdAdapter.pushDeal(credentials, {
      name: dealTitle,
      deal_stage_id: crmOptions.stageId,
      contacts: [contactExternalId ?? existingSync?.external_id ?? ''],
      organization_id: organizationId,
    });
    dealExternalId = rdDealResult.external_id;
  } else if (crmOptions.provider === 'kommo') {
    const kommoAdapter = adapter as KommoAdapter;

    const KOMMO_CONTACT_FIELDS = new Set([
      'first_name', 'last_name', 'name', 'company_name', 'position', 'EMAIL', 'PHONE',
    ]);
    const ENUM_FIELD_TYPES = new Set(['select', 'multiselect', 'radiobutton', 'category']);

    let leadFieldDefs: { types: Map<string, string>; enums: Map<string, Array<{ id: number; value: string }>> } = {
      types: new Map(),
      enums: new Map(),
    };
    try {
      leadFieldDefs = await kommoAdapter.getFieldDefinitions(credentials, 'leads');
    } catch {
      // proceed without enum resolution
    }

    const customFieldsValues: Array<{
      field_id?: number;
      field_code?: string;
      values: Array<{ value: string; enum_id?: number }>;
    }> = [];

    for (const [appField, crmField] of Object.entries(fieldMapping)) {
      if (KOMMO_CONTACT_FIELDS.has(crmField)) continue;

      const value = flatLead[appField];
      if (!value) continue;

      const fieldType = leadFieldDefs.types.get(crmField);
      const numericId = parseInt(crmField, 10);
      const isNumeric = !isNaN(numericId) && crmField === numericId.toString();

      if (fieldType && ENUM_FIELD_TYPES.has(fieldType)) {
        const options = leadFieldDefs.enums.get(crmField);
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
        const formatted = formatValueForKommo(value);
        if (isNumeric) {
          customFieldsValues.push({ field_id: numericId, values: [{ value: formatted }] });
        } else {
          customFieldsValues.push({ field_code: crmField, values: [{ value: formatted }] });
        }
      }
    }

    const resolvedContactId = contactExternalId ?? existingSync?.external_id ?? '';
    if (!resolvedContactId) {
      console.error('[crm-push] No contact ID to link Kommo deal');
      return { dealCreated: false, contactExternalId, skippedReason: 'no_contact_id' };
    }

    const result = await kommoAdapter.pushDeal(credentials, {
      title: dealTitle,
      contactExternalId: resolvedContactId,
      pipelineId: parseInt(crmOptions.pipelineId, 10),
      stageId: parseInt(crmOptions.stageId, 10),
      responsibleUserId: crmOptions.responsibleUserId ? parseInt(crmOptions.responsibleUserId, 10) : undefined,
      customFieldsValues: customFieldsValues.length > 0 ? customFieldsValues : undefined,
    });
    dealExternalId = result.external_id;
  } else {
    return { dealCreated: false, contactExternalId, skippedReason: 'unsupported_provider' };
  }

  if (dealExternalId) {
    await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: leadId,
      channel: 'crm',
      type: 'crm_deal_created',
      external_id: dealExternalId,
      metadata: {
        crm_provider: crmOptions.provider,
        person_external_id: contactExternalId,
        pipeline_id: crmOptions.pipelineId,
        stage_id: crmOptions.stageId,
      },
    } as Record<string, unknown>);

    dispatchWebhookEvent(supabase, orgId, 'crm.deal_created', {
      lead_id: leadId,
      crm_provider: crmOptions.provider,
      deal_external_id: dealExternalId,
      pipeline_id: crmOptions.pipelineId,
      stage_id: crmOptions.stageId,
    }).catch((err) => console.error('[webhook] crm.deal_created dispatch failed:', err));

    return { dealCreated: true, dealExternalId, contactExternalId };
  }

  return { dealCreated: false, contactExternalId };
}

/**
 * Wrapper that builds CrmPushOptions from the org's CRM connection defaults.
 * Returns skippedReason='no_defaults' if defaults aren't configured.
 *
 * Used by /api/feedback (closer-feedback flow) where the caller has no
 * UI form to gather pipeline/stage from the user.
 */
export async function pushLeadToCrmWithDefaults(
  orgId: string,
  leadId: string,
): Promise<CrmPushResult> {
  const supabase = createServiceRoleClient();

  const { data: connection } = (await from(supabase, 'crm_connections')
    .select('crm_provider, default_pipeline_id, default_stage_id, default_responsible_user_id, status')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: {
      crm_provider: CrmProvider;
      default_pipeline_id: string | null;
      default_stage_id: string | null;
      default_responsible_user_id: string | null;
      status: string;
    } | null;
  };

  if (!connection) {
    return { dealCreated: false, skippedReason: 'no_connection' };
  }

  if (!connection.default_pipeline_id || !connection.default_stage_id) {
    return { dealCreated: false, skippedReason: 'no_defaults' };
  }

  return pushLeadToCrm(orgId, leadId, {
    provider: connection.crm_provider,
    pipelineId: connection.default_pipeline_id,
    stageId: connection.default_stage_id,
    responsibleUserId: connection.default_responsible_user_id ?? undefined,
  });
}
