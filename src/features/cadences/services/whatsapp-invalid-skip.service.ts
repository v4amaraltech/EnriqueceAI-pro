import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import { markLeadLostOnCadenceEnd } from './cadence-end-loss.service';

/**
 * Destrava inscrições paradas num passo de WhatsApp de lead sem WhatsApp.
 *
 * A fila esconde passos de WhatsApp de lead com `whatsapp_invalid_at`
 * (`fetch-pending-activities.ts`), mas o `current_step` não andava: a inscrição
 * ficava ativa num passo que ninguém vê. `reportWhatsAppInvalid` já pula os
 * WhatsApp no momento em que o SDR avisa, e isso não cobre quem é marcado
 * ANTES de entrar na cadência (Recovery, troca de cadência, novo enrollment) —
 * em 18/set eram 235 inscrições ativas da Recovery nessa situação, 105 delas
 * com passo de outro canal esperando.
 *
 * Roda como pré-passo do motor, com dois desfechos:
 * - existe passo posterior de outro canal → AVANÇA para ele;
 * - a cauda da cadência é só WhatsApp → é fim de cadência: encerra e passa
 *   pela regra de Perdido (`markLeadLostOnCadenceEnd`), que dá "Deixou de
 *   responder" na Recovery e "Nunca respondeu" nas outras. Em 18/set eram 130
 *   inscrições nesse caso, todas no último passo da Recovery e todas COM
 *   telefone — daí o motivo ser não-resposta, não "Contatos inválidos".
 *
 * Tolerante a erro: loga e segue, nunca estoura o motor.
 */

/** Teto de AVANÇOS (escritas) por execução do motor. */
export const WHATSAPP_SKIP_BATCH = 50;

/**
 * Quantas inscrições são lidas por execução. Bem maior que o teto de escritas
 * porque a maioria dos candidatos não está num passo de WhatsApp (ou não tem
 * outro canal para ir): se lêssemos só 50 sem ordenação, o motor varreria
 * sempre as mesmas e nunca alcançaria o resto da fila.
 */
export const WHATSAPP_SCAN_LIMIT = 500;

export interface CadenceStepChannel {
  step_order: number;
  channel: string;
  call_provider?: string | null;
}

/**
 * Passo que depende de WhatsApp: mensagem de WhatsApp ou "Ligação via WhatsApp"
 * (`phone` + `call_provider='whatsapp'`, Epic 7). Mesma regra de supressão da
 * fila e das RPCs de atrasadas — a fila esconde os dois para lead sem WhatsApp.
 */
export function isWhatsAppStep(step: CadenceStepChannel): boolean {
  return step.channel === 'whatsapp' || (step.channel === 'phone' && step.call_provider === 'whatsapp');
}

/**
 * Passo de e-mail. Lead com `email_bounced_at` não tem como recebê-lo: o
 * motor pula esses passos nas cadências de SDR (mesma lógica do WhatsApp).
 */
export function isEmailStep(step: CadenceStepChannel): boolean {
  return step.channel === 'email';
}

/**
 * Próximo passo que NÃO está bloqueado depois de `currentStep`.
 * `null` quando o passo atual não está bloqueado (nada a fazer) ou quando só
 * restam passos bloqueados.
 */
function nextUnblockedStep(
  steps: CadenceStepChannel[],
  currentStep: number,
  isBlocked: (step: CadenceStepChannel) => boolean,
): number | null {
  const current = steps.find((s) => s.step_order === currentStep);
  if (!current || !isBlocked(current)) return null;

  const next = steps
    .filter((s) => s.step_order > currentStep && !isBlocked(s))
    .sort((a, b) => a.step_order - b.step_order)[0];

  return next?.step_order ?? null;
}

/**
 * Próximo passo de canal diferente de WhatsApp depois de `currentStep`.
 * `null` quando o passo atual não é WhatsApp (nada a fazer) ou quando só
 * restam passos de WhatsApp.
 */
export function nextNonWhatsAppStep(
  steps: CadenceStepChannel[],
  currentStep: number,
): number | null {
  return nextUnblockedStep(steps, currentStep, isWhatsAppStep);
}

export type InvalidWhatsAppAction =
  | { action: 'none' }
  | { action: 'advance'; toStep: number }
  | { action: 'end' };

/**
 * O que fazer com uma inscrição parada num passo bloqueado.
 * `none` = passo atual não está bloqueado (ou `current_step` fora da faixa,
 * sobra de edição de cadência); `advance` = há passo liberado adiante;
 * `end` = só restam passos bloqueados (cauda) → fim de cadência.
 */
export function classifyBlockedStep(
  steps: CadenceStepChannel[],
  currentStep: number,
  isBlocked: (step: CadenceStepChannel) => boolean,
): InvalidWhatsAppAction {
  const current = steps.find((s) => s.step_order === currentStep);
  if (!current || !isBlocked(current)) return { action: 'none' };

  const target = nextUnblockedStep(steps, currentStep, isBlocked);
  return target === null ? { action: 'end' } : { action: 'advance', toStep: target };
}

/** Lead sem WhatsApp: ver `classifyBlockedStep`. */
export function classifyInvalidWhatsAppStep(
  steps: CadenceStepChannel[],
  currentStep: number,
): InvalidWhatsAppAction {
  return classifyBlockedStep(steps, currentStep, isWhatsAppStep);
}

interface Candidate {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  org_id: string;
}

interface BlockedChannelConfig {
  /** Coluna de `leads` que marca o canal como inutilizável. */
  leadFlag: 'whatsapp_invalid_at' | 'email_bounced_at';
  isBlocked: (step: CadenceStepChannel) => boolean;
  /** Restringe a cadências deste tipo (ex.: só `standard`, de SDR). */
  cadenceType?: string;
  logTag: string;
  channelLabel: string;
  skippedEvent: string;
  skippedReason: string;
  endReason: string;
  endMessage: string;
}

async function skipBlockedSteps(
  supabase: SupabaseClient,
  config: BlockedChannelConfig,
): Promise<{ scanned: number; advanced: number; ended: number }> {
  const none = { scanned: 0, advanced: 0, ended: 0 };
  try {
    const select = config.cadenceType
      ? `id, cadence_id, lead_id, current_step, org_id, lead:leads!inner(${config.leadFlag}), cadence:cadences!inner(type)`
      : `id, cadence_id, lead_id, current_step, org_id, lead:leads!inner(${config.leadFlag})`;
    let query = from(supabase, 'cadence_enrollments')
      .select(select)
      .eq('status', 'active')
      .not(`lead.${config.leadFlag}`, 'is', null);
    if (config.cadenceType) query = query.eq('cadence.type', config.cadenceType);
    const { data: candidates } = (await query
      .order('enrolled_at', { ascending: true })
      .limit(WHATSAPP_SCAN_LIMIT)) as { data: Candidate[] | null };

    if (!candidates?.length) return none;

    const cadenceIds = [...new Set(candidates.map((c) => c.cadence_id))];
    const { data: steps } = (await from(supabase, 'cadence_steps')
      .select('cadence_id, step_order, channel, call_provider')
      .in('cadence_id', cadenceIds)) as {
      data: Array<{ cadence_id: string; step_order: number; channel: string; call_provider: string | null }> | null;
    };

    const stepsByCadence = new Map<string, CadenceStepChannel[]>();
    for (const step of steps ?? []) {
      const list = stepsByCadence.get(step.cadence_id) ?? [];
      list.push({ step_order: step.step_order, channel: step.channel, call_provider: step.call_provider });
      stepsByCadence.set(step.cadence_id, list);
    }

    let advanced = 0;
    let ended = 0;
    for (const enrollment of candidates) {
      if (advanced + ended >= WHATSAPP_SKIP_BATCH) break;
      const decision = classifyBlockedStep(
        stepsByCadence.get(enrollment.cadence_id) ?? [],
        enrollment.current_step,
        config.isBlocked,
      );
      if (decision.action === 'none') continue;

      if (decision.action === 'advance') {
        // O trigger `calculate_next_step_due` recalcula o vencimento no UPDATE.
        const { error } = await from(supabase, 'cadence_enrollments')
          .update({ current_step: decision.toStep } as Record<string, unknown>)
          .eq('id', enrollment.id)
          .eq('current_step', enrollment.current_step);
        if (error) {
          console.error(`[${config.logTag}] enrollment=${enrollment.id} falha ao avançar:`, error.message);
          continue;
        }

        await logLeadEvent(supabase, {
          orgId: enrollment.org_id,
          leadId: enrollment.lead_id,
          userId: null,
          event: config.skippedEvent,
          message: `Passo ${enrollment.current_step} (${config.channelLabel}) pulado automaticamente — ${config.skippedReason}; cadência seguiu para o passo ${decision.toStep}`,
          metadata: {
            cadence_id: enrollment.cadence_id,
            enrollment_id: enrollment.id,
            from_step: enrollment.current_step,
            to_step: decision.toStep,
          },
        });
        advanced++;
        continue;
      }

      // Cauda só de passos bloqueados = fim de cadência. Encerra ANTES de
      // chamar a regra de Perdido: ela recusa lead com cadência aberta e, com
      // a inscrição ainda ativa, bloquearia a si mesma.
      const { error: endError } = await from(supabase, 'cadence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
        .eq('id', enrollment.id)
        .eq('status', 'active')
        .eq('current_step', enrollment.current_step);
      if (endError) {
        console.error(`[${config.logTag}] enrollment=${enrollment.id} falha ao encerrar:`, endError.message);
        continue;
      }

      await logLeadEvent(supabase, {
        orgId: enrollment.org_id,
        leadId: enrollment.lead_id,
        userId: null,
        event: 'cadence_completed',
        message: config.endMessage,
        metadata: {
          cadence_id: enrollment.cadence_id,
          enrollment_id: enrollment.id,
          reason: config.endReason,
          last_step: enrollment.current_step,
        },
      });

      await markLeadLostOnCadenceEnd({
        orgId: enrollment.org_id,
        leadId: enrollment.lead_id,
        cadenceId: enrollment.cadence_id,
        enrollmentId: enrollment.id,
      });
      ended++;
    }

    if (advanced > 0 || ended > 0) {
      console.warn(`[${config.logTag}] ${config.skippedReason}: ${advanced} avançada(s), ${ended} encerrada(s) por cauda de ${config.channelLabel}`);
    }
    return { scanned: candidates.length, advanced, ended };
  } catch (err) {
    console.error(`[${config.logTag}] falha inesperada (motor segue):`, err);
    return none;
  }
}

export function skipWhatsAppStepsForInvalidLeads(
  supabase: SupabaseClient,
): Promise<{ scanned: number; advanced: number; ended: number }> {
  return skipBlockedSteps(supabase, {
    leadFlag: 'whatsapp_invalid_at',
    isBlocked: isWhatsAppStep,
    logTag: 'wa-skip',
    channelLabel: 'WhatsApp',
    skippedEvent: 'step_skipped_whatsapp_invalid',
    skippedReason: 'lead sem WhatsApp',
    endReason: 'whatsapp_invalid_tail',
    endMessage: 'Cadência concluída — só restavam passos de WhatsApp e o lead está sem WhatsApp',
  });
}

/**
 * Destrava inscrições de SDR paradas num passo de e-mail de lead com bounce.
 * Antes o bounce PAUSAVA todas as outras cadências do lead (inclusive as de
 * ligação/WhatsApp) e nada as retomava — limbo. Agora só a cadência que
 * originou o bounce para; nas outras, os passos de e-mail são pulados.
 * Cadências `auto_email` ficam fora: o motor de e-mail já trata o bounce.
 */
export function skipEmailStepsForBouncedLeads(
  supabase: SupabaseClient,
): Promise<{ scanned: number; advanced: number; ended: number }> {
  return skipBlockedSteps(supabase, {
    leadFlag: 'email_bounced_at',
    isBlocked: isEmailStep,
    cadenceType: 'standard',
    logTag: 'email-skip',
    channelLabel: 'e-mail',
    skippedEvent: 'step_skipped_email_bounced',
    skippedReason: 'e-mail do lead com bounce',
    endReason: 'email_bounced_tail',
    endMessage: 'Cadência concluída — só restavam passos de e-mail e o e-mail do lead deu bounce',
  });
}
