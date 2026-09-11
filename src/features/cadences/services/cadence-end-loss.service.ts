import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { dispatchWebhookEvent } from './webhook-dispatch.service';
import {
  getInboundRecoveryCadenceId,
  scheduleInboundRecovery,
} from '@/features/leads/services/inbound-recovery.service';

/**
 * Perdido automático no fim natural da cadência.
 *
 * Quando o último passo é executado (ou pulado) e a cadência conclui, o lead
 * vira Perdido na hora com o motivo "Nunca respondeu" — em vez de esperar os
 * 21 dias de inatividade do expire-inactive-leads. Na cadência Recovery o
 * motivo é "Deixou de responder": é o motivo que ela já usa e, por não estar
 * na lista de motivos reativáveis, não reagenda a Recovery (sem loop).
 *
 * Proteções (o lead fica como está se qualquer uma falhar):
 * - status ainda 'new' ou 'contacted' (respondeu/reunião/ganho não é tocado);
 * - nenhuma outra cadência aberta ('active'/'paused') — ex.: a
 *   "Inbound — E-mail (auto)" termina enquanto o SDR ainda trabalha o lead na
 *   "Inbound 2.0";
 * - nenhum retorno agendado pendente (o SDR planejou falar com o lead de novo).
 *
 * Mesmos efeitos do perdido manual (markLeadAsLost): evento na timeline,
 * status + motivo no lead, motivo carimbado no enrollment, webhook
 * lead.unqualified e recuperação automática de inbound. Nunca lança — falha
 * aqui não pode quebrar a execução do passo.
 */

export const CADENCE_END_LOSS_REASON = 'Nunca respondeu';
export const RECOVERY_END_LOSS_REASON = 'Deixou de responder';
export const CADENCE_END_LOSS_NOTES = 'Cadência concluída sem resposta';

const LOSABLE_STATUSES = ['new', 'contacted'];

export type CadenceEndLossResult =
  | { lost: true; reasonName: string }
  | {
      lost: false;
      skipped: 'lead_status' | 'other_open_cadence' | 'scheduled_return' | 'reason_not_found' | 'error';
    };

export function pickCadenceEndLossReasonName(orgId: string, cadenceId: string): string {
  return getInboundRecoveryCadenceId(orgId) === cadenceId ? RECOVERY_END_LOSS_REASON : CADENCE_END_LOSS_REASON;
}

export async function markLeadLostOnCadenceEnd(params: {
  orgId: string;
  leadId: string;
  cadenceId: string;
  enrollmentId: string;
}): Promise<CadenceEndLossResult> {
  const { orgId, leadId, cadenceId, enrollmentId } = params;
  try {
    const supabase = createServiceRoleClient();

    const { data: lead } = (await from(supabase, 'leads')
      .select('status')
      .eq('id', leadId)
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .maybeSingle()) as { data: { status: string } | null };
    if (!lead || !LOSABLE_STATUSES.includes(lead.status)) return { lost: false, skipped: 'lead_status' };

    const { data: openEnrollments } = (await from(supabase, 'cadence_enrollments')
      .select('id')
      .eq('lead_id', leadId)
      .in('status', ['active', 'paused'])
      .limit(1)) as { data: Array<{ id: string }> | null };
    if (openEnrollments?.length) return { lost: false, skipped: 'other_open_cadence' };

    const { data: pendingReturns } = (await from(supabase, 'scheduled_activities')
      .select('id')
      .eq('lead_id', leadId)
      .eq('status', 'pending')
      .limit(1)) as { data: Array<{ id: string }> | null };
    if (pendingReturns?.length) return { lost: false, skipped: 'scheduled_return' };

    const reasonName = pickCadenceEndLossReasonName(orgId, cadenceId);
    // ilike sem curinga = igualdade sem diferenciar maiúsculas ("Nunca Respondeu")
    const { data: reasons } = (await from(supabase, 'loss_reasons')
      .select('id, name')
      .eq('org_id', orgId)
      .ilike('name', reasonName)
      .limit(1)) as { data: Array<{ id: string; name: string }> | null };
    const reason = reasons?.[0];
    if (!reason) {
      console.error(`[cadence-end-loss] org=${orgId} sem motivo de perda "${reasonName}" — lead=${leadId} não foi perdido`);
      return { lost: false, skipped: 'reason_not_found' };
    }

    // Timeline ANTES do status, mesma ordem do markLeadAsLost: o rastro
    // sobrevive mesmo se o UPDATE do lead falhar.
    const { error: interactionError } = await from(supabase, 'interactions').insert({
      org_id: orgId,
      lead_id: leadId,
      cadence_id: cadenceId,
      channel: 'system',
      type: 'sent',
      message_content: `Lead marcado como perdido — Motivo: ${reason.name} | ${CADENCE_END_LOSS_NOTES}`,
      performed_by: null,
      metadata: {
        system_event: 'lead_lost',
        reason: 'cadence_completed_no_reply',
        loss_reason_id: reason.id,
        loss_reason_name: reason.name,
        enrollment_id: enrollmentId,
      },
    } as Record<string, unknown>);
    if (interactionError) {
      console.error(`[cadence-end-loss] lead=${leadId} evento na timeline falhou:`, interactionError.message);
    }

    // Status revalidado no próprio UPDATE: se o lead respondeu entre a
    // checagem e aqui, nada muda.
    const { data: updated, error: leadError } = (await from(supabase, 'leads')
      .update({
        status: 'unqualified',
        loss_reason_id: reason.id,
        loss_notes: CADENCE_END_LOSS_NOTES,
      } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', orgId)
      .in('status', LOSABLE_STATUSES)
      .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (leadError) {
      console.error(`[cadence-end-loss] lead=${leadId} falha ao marcar perdido:`, leadError.message);
      return { lost: false, skipped: 'error' };
    }
    if (!updated?.length) return { lost: false, skipped: 'lead_status' };

    // Motivo no enrollment que acabou de concluir (gráficos de motivo de perda
    // por cadência). Só se ainda estiver vazio.
    await from(supabase, 'cadence_enrollments')
      .update({ loss_reason_id: reason.id, loss_notes: CADENCE_END_LOSS_NOTES } as Record<string, unknown>)
      .eq('id', enrollmentId)
      .is('loss_reason_id', null);

    dispatchWebhookEvent(supabase, orgId, 'lead.unqualified', {
      lead_id: leadId,
      loss_reason_id: reason.id,
      loss_notes: CADENCE_END_LOSS_NOTES,
    }).catch((err) => console.error('[cadence-end-loss] webhook lead.unqualified falhou:', err));

    // Inbound perdido por motivo reativável volta pela Recovery (no-op para
    // "Deixou de responder", lead outbound, org sem regra ou flag desligado).
    await scheduleInboundRecovery({ orgId, leadIds: [leadId], lossReasonName: reason.name, userId: null });

    return { lost: true, reasonName: reason.name };
  } catch (err) {
    console.error(`[cadence-end-loss] lead=${leadId} falha inesperada:`, err);
    return { lost: false, skipped: 'error' };
  }
}
