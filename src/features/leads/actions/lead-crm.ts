'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { pushLeadToCrm } from '../services/crm-push.service';
import { resyncCrmDealFields } from '../services/crm-resync.service';
import { sendCloserFeedbackEmail } from './send-closer-feedback';
import type {
  CrmConnectionRow,
  CrmPipeline,
  CrmProvider,
  CrmStage,
} from '@/features/integrations/types/crm';
import { ensureFreshCredentials } from '@/features/integrations/services/crm-token';
import { PipedriveAdapter } from '@/features/integrations/services/pipedrive.adapter';
import { HubSpotAdapter } from '@/features/integrations/services/hubspot.adapter';
import { RDStationAdapter } from '@/features/integrations/services/rdstation.adapter';
import { KommoAdapter } from '@/features/integrations/services/kommo.adapter';

import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

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

export interface KommoUser {
  id: string;
  name: string;
  email: string;
}

export async function fetchKommoUsers(): Promise<ActionResult<KommoUser[]>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId } = auth.data;

    const serviceSupabase = createServiceRoleClient();

    const { data: connection } = (await from(serviceSupabase, 'crm_connections')
      .select('*')
      .eq('org_id', orgId)
      .eq('crm_provider', 'kommo')
      .eq('status', 'connected')
      .single()) as { data: CrmConnectionRow | null };

    if (!connection) {
      return { success: false, error: 'Conexão Kommo não encontrada' };
    }

    const adapter = new KommoAdapter();
    const credentials = await ensureFreshCredentials(connection, adapter, serviceSupabase);
    const users = await adapter.fetchUsers(credentials);

    return {
      success: true,
      data: users.map((u) => ({ id: u.id.toString(), name: u.name, email: u.email })),
    };
  } catch (error) {
    console.error('[fetchKommoUsers] Error:', error);
    return { success: false, error: 'Erro ao buscar usuários do Kommo' };
  }
}

/**
 * Re-apply the current Kommo field_mapping to an existing deal. Used when the
 * user edits the integration mapping after a lead has already been pushed.
 */
export async function resyncLeadToCrm(
  leadId: string,
): Promise<ActionResult<{ dealId: number | null; fieldsTotal: number; succeeded: number; failed: number; failedKeys: string[] }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId } = auth.data;

  // Confirm the lead belongs to the caller's org before resync (the service uses
  // service role and would otherwise honor any leadId).
  const { data: leadOrg } = (await from(auth.data.supabase, 'leads')
    .select('org_id')
    .eq('id', leadId)
    .single()) as { data: { org_id: string } | null };
  if (!leadOrg || leadOrg.org_id !== orgId) {
    return { success: false, error: 'Lead não encontrado' };
  }

  const result = await resyncCrmDealFields(leadId);

  if (result.errorCode) {
    const msg = result.errorCode === 'no_kommo_connection'
      ? 'Nenhuma conexão Kommo conectada para esta organização'
      : result.errorCode === 'no_synced_contact'
        ? 'Lead ainda não foi sincronizado com o Kommo. Marque como ganho primeiro.'
        : result.errorCode === 'no_deal'
          ? 'Nenhum deal encontrado no Kommo para este lead'
          : result.errorCode === 'no_subdomain'
            ? 'Configuração Kommo incompleta — subdomain ausente'
            : 'Lead não encontrado';
    return { success: false, error: msg };
  }

  logAudit({
    orgId,
    userId: auth.data.userId,
    action: 'lead.crm_resynced',
    resourceType: 'lead',
    resourceId: leadId,
    metadata: {
      crm_provider: 'kommo',
      deal_id: result.dealId,
      fields_total: result.fieldsTotal,
      fields_failed: result.failed.length,
    },
  });

  return {
    success: true,
    data: {
      dealId: result.dealId,
      fieldsTotal: result.fieldsTotal,
      succeeded: result.succeeded.length,
      failed: result.failed.length,
      failedKeys: result.failed,
    },
  };
}

export async function markLeadAsWon(
  leadId: string,
  crmOptions?: { provider: CrmProvider; pipelineId: string; stageId: string; responsibleUserId?: string },
): Promise<ActionResult<{ dealCreated?: boolean }>> {
  try {
    const auth = await getAuthOrgIdResult();
    if (!auth.success) return auth;
    const { orgId, userId, supabase } = auth.data;

    // 1. Update lead to won — SDR's production is "fazer a reunião acontecer +
    // enviar pro CRM". Closer feedback later registers SAL quality (rating,
    // meeting_done/no_show) but does NOT control lead status. This restores
    // the Meetime-style flow that existed before 2026-05-08, when commits
    // 49d6f88/8555502 introduced the qualified→won split via DB trigger.
    const nowIso = new Date().toISOString();

    // Auto-fill the org's "meeting held" custom field with today's date when
    // marking the lead as won. Looked up by system_key='meeting_held_at' so
    // we don't hardcode V4 Amaral's UUID — any org that creates a date field
    // with that system_key opts in automatically. Only writes when the
    // current value is empty so a manually-entered date (re-scheduled
    // meeting, etc.) wins over the automatic fill.
    const { data: mhCustomField } = (await from(supabase, 'custom_fields')
      .select('id')
      .eq('org_id', orgId)
      .eq('system_key', 'meeting_held_at')
      .maybeSingle()) as { data: { id: string } | null };

    // Idempotency guard: re-marking an already-won lead must NOT re-stamp
    // won_at/meeting_held_at — that overwrites the real win date and (combined
    // with a duplicate feedback request) is how the same meeting ended up
    // graded twice. We still upsert status='won' (a no-op) so the legitimate
    // reopen→re-win path (status='qualified' at that point) stamps fresh.
    const { data: currentLead } = (await from(supabase, 'leads')
      .select('status, custom_field_values')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .single()) as { data: { status: string; custom_field_values: Record<string, unknown> | null } | null };
    const wasAlreadyWon = currentLead?.status === 'won';

    let customFieldUpdate: Record<string, unknown> | null = null;
    if (mhCustomField) {
      const currentValues = (currentLead?.custom_field_values ?? {}) as Record<string, unknown>;
      const existingValue = currentValues[mhCustomField.id];
      if (existingValue === undefined || existingValue === null || existingValue === '') {
        // Custom field is type='date' — store as YYYY-MM-DD in the org's
        // local timezone (BRT), matching what the SDR would type in the UI.
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        customFieldUpdate = {
          custom_field_values: { ...currentValues, [mhCustomField.id]: today },
        };
      }
    }

    // Preserve the original win timestamps when the lead was already won.
    const wonStamps = wasAlreadyWon
      ? {}
      : { won_by: userId, won_at: nowIso, meeting_held_at: nowIso, qualified_at: nowIso };

    const { error: leadError } = await from(supabase, 'leads')
      .update({
        status: 'won',
        ...wonStamps,
        ...(customFieldUpdate ?? {}),
      } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', orgId);

    const qErr = handleQueryError(leadError, 'Erro ao marcar lead como ganho', 'lead-crm');
    if (qErr) return qErr;

    // Dispatch lead.qualified webhook (event name kept stable for subscriber
    // compatibility — semantically the same "SDR pushed lead forward").
    dispatchWebhookEvent(supabase, orgId, 'lead.qualified', {
      lead_id: leadId,
      crm_provider: crmOptions?.provider ?? null,
    }).catch((err) => console.error('[webhook] lead.qualified dispatch failed:', err));

    // 2. Complete active/paused enrollments
    await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused']);

    // 2a. Cancel pending scheduled return-activities for the lead. Once it's
    // won, the SDR shouldn't see "ligar de volta" tasks lingering in the queue.
    await from(supabase, 'scheduled_activities' as never)
      .update({ status: 'cancelled' } as Record<string, unknown>)
      .eq('lead_id', leadId)
      .eq('status', 'pending');

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

    // 3. Push to CRM if requested — extracted to crm-push.service so it can also
    // be invoked by /api/feedback (closer-feedback flow), which has no UI form
    // to gather pipeline/stage from and instead reads them from connection defaults.
    let dealCreated = false;
    if (crmOptions) {
      const pushResult = await pushLeadToCrm(orgId, leadId, crmOptions);
      dealCreated = pushResult.dealCreated;
    }

    // 4. Send closer feedback email (fire-and-forget)
    const { data: leadForFeedback } = (await from(supabase, 'leads')
      .select('closer_id, nome_fantasia, razao_social')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .single()) as { data: { closer_id: string | null; nome_fantasia: string | null; razao_social: string | null } | null };

    if (leadForFeedback?.closer_id) {
      const { data: closer } = (await from(supabase, 'closers')
        .select('id, name, email, phone')
        .eq('id', leadForFeedback.closer_id)
        .single()) as { data: { id: string; name: string; email: string; phone: string | null } | null };

      if (closer) {
        const leadName = leadForFeedback.nome_fantasia ?? leadForFeedback.razao_social ?? 'Lead';
        sendCloserFeedbackEmail({
          leadId,
          orgId,
          closerId: closer.id,
          closerName: closer.name,
          closerEmail: closer.email,
          closerPhone: closer.phone,
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
