'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { sendCloserFeedbackEmail } from './send-closer-feedback';
import type {
  CrmConnectionRow,
  CrmPipeline,
  CrmProvider,
  CrmStage,
} from '@/features/integrations/types/crm';
import { DEFAULT_FIELD_MAPPINGS } from '@/features/integrations/types/crm';
import { PipedriveAdapter } from '@/features/integrations/services/pipedrive.adapter';
import { HubSpotAdapter } from '@/features/integrations/services/hubspot.adapter';
import { RDStationAdapter } from '@/features/integrations/services/rdstation.adapter';
import { KommoAdapter } from '@/features/integrations/services/kommo.adapter';
import { CRMRegistry } from '@/features/integrations/services/crm-registry';
import { ensureFreshCredentials } from '@/features/integrations/services/crm-token';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

/**
 * Format date/datetime values to ISO 8601 with timezone (Y-m-d\TH:i:sP) for Kommo API.
 * Kommo rejects bare date strings like "2026-03-27" or "2026-03-27T10:00".
 * Detects date-like values by pattern and converts them; non-date values pass through unchanged.
 */
function formatValueForKommo(value: string): string {
  // Detect date-like values in various formats and convert to Kommo's required ISO 8601 with timezone
  // Covers: 2026-03-27, 2026-03-27T10:00, 2026-03-27T10:00:00, 2026-03-27T10:00:00.000Z, etc.
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      // Kommo requires Y-m-d\TH:i:sP format — e.g. 2026-03-27T00:00:00+00:00
      return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
    }
  }
  return value;
}

export interface CrmPipelinesEntry {
  provider: CrmProvider;
  pipelines: CrmPipeline[];
}

export async function fetchCrmPipelines(): Promise<
  ActionResult<{ connections: CrmPipelinesEntry[] }>
> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId } = auth.data;

    // Use service role to read encrypted credentials (bypasses RLS — auth already verified above)
    const serviceSupabase = createServiceRoleClient();

    const { data: rows, error: queryError } = (await from(serviceSupabase, 'crm_connections')
      .select('*')
      .eq('org_id', orgId)
      .in('status', ['connected', 'syncing'])) as { data: CrmConnectionRow[] | null; error: { message: string } | null };

    if (queryError) {
      console.error('[fetchCrmPipelines] Query error:', queryError.message);
    }

    if (!rows?.length) {
      return { success: true, data: { connections: [] } };
    }

    const results = await Promise.allSettled(
      rows.map(async (connection): Promise<CrmPipelinesEntry | null> => {
        let pipelines: CrmPipeline[] = [];

        if (connection.crm_provider === 'pipedrive') {
          const adapter = new PipedriveAdapter();
          const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
          const rawPipelines = await adapter.fetchPipelines(credentials);
          pipelines = rawPipelines.map((p) => ({
            id: p.id.toString(),
            name: p.name,
            stages: [],
          }));
        } else if (connection.crm_provider === 'hubspot') {
          const adapter = new HubSpotAdapter();
          const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
          const rawPipelines = await adapter.fetchPipelines(credentials);
          pipelines = rawPipelines.map((p) => ({
            id: p.id,
            name: p.label,
            stages: [],
          }));
        } else if (connection.crm_provider === 'rdstation') {
          const adapter = new RDStationAdapter();
          const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
          const rawPipelines = await adapter.fetchPipelines(credentials);
          pipelines = rawPipelines.map((p) => ({
            id: p.id,
            name: p.name,
            stages: [],
          }));
        } else if (connection.crm_provider === 'kommo') {
          const adapter = new KommoAdapter();
          const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
          const rawPipelines = await adapter.fetchPipelines(credentials);
          pipelines = rawPipelines.map((p) => ({
            id: p.id.toString(),
            name: p.name,
            stages: [],
          }));
        }

        return pipelines.length > 0
          ? { provider: connection.crm_provider, pipelines }
          : null;
      }),
    );

    const connections: CrmPipelinesEntry[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        connections.push(result.value);
      } else if (result.status === 'rejected') {
        console.error('[fetchCrmPipelines] Error fetching CRM:', result.reason);
      }
    }

    return { success: true, data: { connections } };
  } catch (error) {
    console.error('[fetchCrmPipelines] Error:', error);
    return { success: false, error: 'Erro ao buscar funis do CRM' };
  }
}

export async function fetchPipelineStages(
  provider: CrmProvider,
  pipelineId: string,
): Promise<ActionResult<CrmStage[]>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId } = auth.data;

    const serviceSupabase = createServiceRoleClient();

    const { data: connection } = (await from(serviceSupabase, 'crm_connections')
      .select('*')
      .eq('org_id', orgId)
      .eq('crm_provider', provider)
      .eq('status', 'connected')
      .single()) as { data: CrmConnectionRow | null };

    if (!connection) {
      return { success: false, error: 'Conexão CRM não encontrada' };
    }

    if (provider === 'pipedrive') {
      const adapter = new PipedriveAdapter();
      const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
      const rawStages = await adapter.fetchStages(credentials, Number(pipelineId));
      return {
        success: true,
        data: rawStages
          .sort((a, b) => a.order_nr - b.order_nr)
          .map((s) => ({ id: s.id.toString(), name: s.name })),
      };
    }

    if (provider === 'hubspot') {
      const adapter = new HubSpotAdapter();
      const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
      const rawStages = await adapter.fetchStages(credentials, pipelineId);
      return {
        success: true,
        data: rawStages
          .sort((a, b) => a.displayOrder - b.displayOrder)
          .map((s) => ({ id: s.id, name: s.label })),
      };
    }

    if (provider === 'rdstation') {
      const adapter = new RDStationAdapter();
      const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
      const rawStages = await adapter.fetchStages(credentials, pipelineId);
      return {
        success: true,
        data: rawStages
          .sort((a, b) => a.order - b.order)
          .map((s) => ({ id: s.id, name: s.name })),
      };
    }

    if (provider === 'kommo') {
      const adapter = new KommoAdapter();
      const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
      const rawStages = await adapter.fetchStages(credentials, Number(pipelineId));
      return {
        success: true,
        data: rawStages
          .sort((a, b) => a.sort - b.sort)
          .map((s) => ({ id: s.id.toString(), name: s.name })),
      };
    }

    return { success: true, data: [] };
  } catch (error) {
    console.error('[fetchPipelineStages] Error:', error);
    return { success: false, error: 'Erro ao buscar etapas do funil' };
  }
}

export async function markLeadAsWon(
  leadId: string,
  crmOptions?: { provider: CrmProvider; pipelineId: string; stageId: string },
): Promise<ActionResult<{ dealCreated?: boolean }>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId, userId, supabase } = auth.data;
    // Use service role for lead update to bypass RLS — any SDR that can view the lead should be able to mark it as won
    const serviceSupabaseForLead = createServiceRoleClient();

    // 1. Update lead status to qualified + record who won it
    const { error: leadError } = await from(serviceSupabaseForLead, 'leads')
      .update({ status: 'qualified', won_by: userId } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', orgId);

    const qErr = handleQueryError(leadError, 'Erro ao marcar lead como ganho', 'lead-crm');
    if (qErr) return qErr;

    // Dispatch lead.qualified webhook
    dispatchWebhookEvent(supabase, orgId, 'lead.qualified', {
      lead_id: leadId,
      crm_provider: crmOptions?.provider ?? null,
    }).catch((err) => console.error('[webhook] lead.qualified dispatch failed:', err));

    // 2. Complete active/paused enrollments
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);

    // 2b. Record system interaction for timeline visibility
    await from(supabase, 'interactions')
      .insert({
        org_id: orgId,
        lead_id: leadId,
        channel: 'system',
        type: 'sent',
        message_content: 'Lead marcado como ganho',
        performed_by: userId,
        metadata: { system_event: 'lead_won' },
      } as Record<string, unknown>);

    // 3. Push to CRM if requested
    let dealCreated = false;
    if (crmOptions) {
      const serviceSupabase = createServiceRoleClient();
      const { data: connection } = (await from(serviceSupabase, 'crm_connections')
        .select('*')
        .eq('org_id', orgId)
        .eq('crm_provider', crmOptions.provider)
        .eq('status', 'connected')
        .single()) as { data: CrmConnectionRow | null };

      if (connection) {
        const adapter = CRMRegistry.getAdapter(crmOptions.provider);
        const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);

        // Fetch lead data for pushContact
        const { data: lead } = (await from(supabase, 'leads')
          .select('*')
          .eq('id', leadId)
          .eq('org_id', orgId)
          .single()) as { data: Record<string, string | null> | null };

        if (lead) {
          const fieldMapping = connection.field_mapping?.leads ?? DEFAULT_FIELD_MAPPINGS[crmOptions.provider].leads;

          // Build flat lead with custom field values resolved as top-level keys
          const flatLead: Record<string, string | null> = { ...lead };
          const cfValues = lead.custom_field_values as unknown as Record<string, string> | null;
          if (cfValues && typeof cfValues === 'object') {
            for (const [cfId, cfVal] of Object.entries(cfValues)) {
              flatLead[`custom_${cfId}`] = typeof cfVal === 'string' ? cfVal : String(cfVal ?? '');
            }
          }

          // Resolve assigned_to UUID to member name for CRM mapping
          if (lead.assigned_to) {
            const { data: authUser } = await serviceSupabase.auth.admin.getUserById(lead.assigned_to as string);
            flatLead.assigned_to_name = authUser?.user?.user_metadata?.name ?? authUser?.user?.email ?? null;
          }

          // Check if Contact/Person already synced (dedup)
          const { data: existingSync } = (await from(supabase, 'interactions')
            .select('external_id')
            .eq('lead_id', leadId)
            .eq('type', 'crm_synced')
            .maybeSingle()) as { data: { external_id: string } | null };

          // Create/update Contact/Person
          const { external_id: contactExternalId } = await adapter.pushContact(
            credentials,
            flatLead,
            fieldMapping,
            existingSync?.external_id ?? undefined,
          );

          // Record contact sync if new
          if (!existingSync) {
            await from(supabase, 'interactions').insert({
              org_id: orgId,
              lead_id: leadId,
              channel: 'crm',
              type: 'crm_synced',
              external_id: contactExternalId,
            } as Record<string, unknown>);
          }

          // Create Deal — provider-specific
          const dealTitle = (lead.nome_fantasia ?? lead.razao_social ?? 'Deal') as string;
          let dealExternalId: string;

          if (crmOptions.provider === 'pipedrive') {
            const pipedriveAdapter = adapter as PipedriveAdapter;

            // Create Organization (company) with CNPJ and address
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

            // Update Person to link to Organization
            await pipedriveAdapter.pushContact(
              credentials,
              lead,
              fieldMapping,
              contactExternalId,
            );
            // Set org_id on the person via direct API call
            const apiDomain = credentials.api_key ?? '';
            await fetch(`${apiDomain || 'https://api.pipedrive.com'}/api/v1/persons/${contactExternalId}`, {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${credentials.access_token}`,
              },
              body: JSON.stringify({ org_id: orgExternalId }),
            });

            // Try to set lead source as custom field, fallback to note
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
              person_id: parseInt(contactExternalId, 10),
              pipeline_id: parseInt(crmOptions.pipelineId, 10),
              stage_id: parseInt(crmOptions.stageId, 10),
              org_id: orgExternalId,
              customFields,
            });
            dealExternalId = result.external_id;

            // Fallback: add origin as note on the deal if custom field failed
            if (leadSource && origemFieldFailed) {
              try {
                await pipedriveAdapter.pushActivity(credentials, {
                  contact_external_id: contactExternalId,
                  type: 'note',
                  subject: 'Origem do Lead',
                  body: `Origem: ${leadSource}`,
                  timestamp: new Date().toISOString(),
                });
              } catch {
                // Best effort — don't fail the deal creation
              }
            }
          } else if (crmOptions.provider === 'hubspot') {
            const hubspotAdapter = adapter as HubSpotAdapter;

            // Create Company with CNPJ and address fields
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

            // Associate Contact to Company
            await hubspotAdapter.associateContactToCompany(credentials, contactExternalId, companyId);

            // Try to set lead source as custom property (requires crm.schemas.deals.write scope)
            const hsLeadSource = lead.lead_source as string | null;
            let customProperties: Record<string, string> | undefined;
            if (hsLeadSource) {
              try {
                await hubspotAdapter.ensureOrigemProperty(credentials);
                customProperties = { origem: hsLeadSource };
              } catch {
                // Scope not granted — skip custom property, deal still gets created
              }
            }

            // Create Deal linked to Contact + Company
            const result = await hubspotAdapter.pushDeal(credentials, {
              title: dealTitle,
              contactId: contactExternalId,
              pipelineId: crmOptions.pipelineId,
              stageId: crmOptions.stageId,
              companyId,
              customProperties,
            });
            dealExternalId = result.external_id;
          } else if (crmOptions.provider === 'rdstation') {
            const rdAdapter = adapter as RDStationAdapter;

            // Create Organization with Razão Social | CNPJ + address + phone
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
              // Organization may already exist (name must be unique) — continue without it
            }

            // Update Contact with organization_id if available
            if (organizationId) {
              try {
                await rdAdapter.pushContact(
                  credentials,
                  { ...lead, organization_id: organizationId } as Record<string, string | null>,
                  fieldMapping,
                  contactExternalId,
                );
              } catch {
                // Best effort — don't fail deal creation
              }
            }

            // Create Deal
            const rdDealResult = await rdAdapter.pushDeal(credentials, {
              name: dealTitle,
              deal_stage_id: crmOptions.stageId,
              contacts: [contactExternalId],
              organization_id: organizationId,
            });
            dealExternalId = rdDealResult.external_id;
          } else if (crmOptions.provider === 'kommo') {
            const kommoAdapter = adapter as KommoAdapter;

            // Standard contact fields are handled by pushContact — everything else goes to the deal
            const KOMMO_CONTACT_FIELDS = new Set([
              'first_name', 'last_name', 'name', 'company_name', 'position', 'EMAIL', 'PHONE',
            ]);

            // Build deal custom fields from mapping
            const customFieldsValues: Array<{
              field_id?: number;
              field_code?: string;
              values: Array<{ value: string }>;
            }> = [];

            for (const [appField, crmField] of Object.entries(fieldMapping)) {
              if (KOMMO_CONTACT_FIELDS.has(crmField)) continue;

              // Use flatLead which already has custom_ fields resolved
              const value = flatLead[appField];
              if (!value) continue;

              // Determine if crmField is a numeric ID or a field code
              const numericId = parseInt(crmField, 10);
              const formatted = formatValueForKommo(value);
              if (!isNaN(numericId) && crmField === numericId.toString()) {
                customFieldsValues.push({ field_id: numericId, values: [{ value: formatted }] });
              } else {
                customFieldsValues.push({ field_code: crmField, values: [{ value: formatted }] });
              }
            }

            // Kommo creates leads (deals) with contacts via pushDeal
            const result = await kommoAdapter.pushDeal(credentials, {
              title: dealTitle,
              contactExternalId,
              pipelineId: parseInt(crmOptions.pipelineId, 10),
              stageId: parseInt(crmOptions.stageId, 10),
              customFieldsValues: customFieldsValues.length > 0 ? customFieldsValues : undefined,
            });
            dealExternalId = result.external_id;
          } else {
            // Unsupported provider for deal creation — skip
            dealExternalId = '';
          }

          if (dealExternalId) {
            // Record deal creation
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

            dealCreated = true;

            // Dispatch crm.deal_created webhook
            dispatchWebhookEvent(supabase, orgId, 'crm.deal_created', {
              lead_id: leadId,
              crm_provider: crmOptions.provider,
              deal_external_id: dealExternalId,
              pipeline_id: crmOptions.pipelineId,
              stage_id: crmOptions.stageId,
            }).catch((err) => console.error('[webhook] crm.deal_created dispatch failed:', err));
          }
        }
      }
    }

    // 4. Send closer feedback email (fire-and-forget)
    const { data: leadForFeedback } = (await from(supabase, 'leads')
      .select('closer_id, nome_fantasia, razao_social')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .single()) as { data: { closer_id: string | null; nome_fantasia: string | null; razao_social: string | null } | null };

    if (leadForFeedback?.closer_id) {
      const { data: closer } = (await from(supabase, 'closers')
        .select('id, name, email')
        .eq('id', leadForFeedback.closer_id)
        .single()) as { data: { id: string; name: string; email: string } | null };

      if (closer) {
        const leadName = leadForFeedback.nome_fantasia ?? leadForFeedback.razao_social ?? 'Lead';
        sendCloserFeedbackEmail({
          leadId,
          orgId,
          closerId: closer.id,
          closerName: closer.name,
          closerEmail: closer.email,
          leadName,
          senderUserId: auth.data.userId,
        }).catch((err) => console.error('[markLeadAsWon] Feedback email error:', err));
      }
    }

    logAudit({
      orgId,
      userId: auth.data.userId,
      action: 'lead.marked_won',
      resourceType: 'lead',
      resourceId: leadId,
      metadata: { crm_provider: crmOptions?.provider ?? null, deal_created: dealCreated },
    });

    // Notify managers that a lead was won
    const wonLead = (await from(supabase, 'leads').select('nome_fantasia, razao_social').eq('id', leadId).single() as { data: { nome_fantasia: string | null; razao_social: string | null } | null }).data;
    const wonName = wonLead?.nome_fantasia ?? wonLead?.razao_social ?? 'Lead';
    createNotificationsForOrgMembers({
      orgId,
      type: 'lead_won',
      title: `Lead ganho: ${wonName}`,
      body: crmOptions ? `Enviado para ${crmOptions.provider}` : undefined,
      resourceType: 'lead',
      resourceId: leadId,
      roleFilter: 'manager',
      excludeUserId: userId,
    }).catch((err) => console.error('[notification] lead_won failed:', err));

    revalidatePath('/leads');
    revalidatePath(`/leads/${leadId}`);
    revalidatePath('/atividades');

    return { success: true, data: { dealCreated } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[markLeadAsWon] Error:', message, error);
    return { success: false, error: `Erro ao marcar lead como ganho: ${message}` };
  }
}
