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
  const current = steps.find((s) => s.step_order === currentStep);
  if (!current || current.channel !== 'whatsapp') return null;

  const next = steps
    .filter((s) => s.step_order > currentStep && s.channel !== 'whatsapp')
    .sort((a, b) => a.step_order - b.step_order)[0];

  return next?.step_order ?? null;
}

export type InvalidWhatsAppAction =
  | { action: 'none' }
  | { action: 'advance'; toStep: number }
  | { action: 'end' };

/**
 * O que fazer com uma inscrição de lead sem WhatsApp parada no passo atual.
 * `none` = passo atual não é WhatsApp (ou `current_step` fora da faixa, sobra
 * de edição de cadência); `advance` = há passo de outro canal adiante;
 * `end` = só restam passos de WhatsApp (cauda) → fim de cadência.
 */
export function classifyInvalidWhatsAppStep(
  steps: CadenceStepChannel[],
  currentStep: number,
): InvalidWhatsAppAction {
  const current = steps.find((s) => s.step_order === currentStep);
  if (!current || current.channel !== 'whatsapp') return { action: 'none' };

  const target = nextNonWhatsAppStep(steps, currentStep);
  return target === null ? { action: 'end' } : { action: 'advance', toStep: target };
}

interface Candidate {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  org_id: string;
}

export async function skipWhatsAppStepsForInvalidLeads(
  supabase: SupabaseClient,
): Promise<{ scanned: number; advanced: number; ended: number }> {
  const none = { scanned: 0, advanced: 0, ended: 0 };
  try {
    const { data: candidates } = (await from(supabase, 'cadence_enrollments')
      .select('id, cadence_id, lead_id, current_step, org_id, lead:leads!inner(whatsapp_invalid_at)')
      .eq('status', 'active')
      .not('lead.whatsapp_invalid_at', 'is', null)
      .order('enrolled_at', { ascending: true })
      .limit(WHATSAPP_SCAN_LIMIT)) as { data: Candidate[] | null };

    if (!candidates?.length) return none;

    const cadenceIds = [...new Set(candidates.map((c) => c.cadence_id))];
    const { data: steps } = (await from(supabase, 'cadence_steps')
      .select('cadence_id, step_order, channel')
      .in('cadence_id', cadenceIds)) as {
      data: Array<{ cadence_id: string; step_order: number; channel: string }> | null;
    };

    const stepsByCadence = new Map<string, CadenceStepChannel[]>();
    for (const step of steps ?? []) {
      const list = stepsByCadence.get(step.cadence_id) ?? [];
      list.push({ step_order: step.step_order, channel: step.channel });
      stepsByCadence.set(step.cadence_id, list);
    }

    let advanced = 0;
    let ended = 0;
    for (const enrollment of candidates) {
      if (advanced + ended >= WHATSAPP_SKIP_BATCH) break;
      const decision = classifyInvalidWhatsAppStep(
        stepsByCadence.get(enrollment.cadence_id) ?? [],
        enrollment.current_step,
      );
      if (decision.action === 'none') continue;

      if (decision.action === 'advance') {
        // O trigger `calculate_next_step_due` recalcula o vencimento no UPDATE.
        const { error } = await from(supabase, 'cadence_enrollments')
          .update({ current_step: decision.toStep } as Record<string, unknown>)
          .eq('id', enrollment.id)
          .eq('current_step', enrollment.current_step);
        if (error) {
          console.error(`[wa-skip] enrollment=${enrollment.id} falha ao avançar:`, error.message);
          continue;
        }

        await logLeadEvent(supabase, {
          orgId: enrollment.org_id,
          leadId: enrollment.lead_id,
          userId: null,
          event: 'step_skipped_whatsapp_invalid',
          message: `Passo ${enrollment.current_step} (WhatsApp) pulado automaticamente — lead sem WhatsApp; cadência seguiu para o passo ${decision.toStep}`,
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

      // Cauda só de WhatsApp = fim de cadência. Encerra ANTES de chamar a
      // regra de Perdido: ela recusa lead com cadência aberta e, com a
      // inscrição ainda ativa, bloquearia a si mesma.
      const { error: endError } = await from(supabase, 'cadence_enrollments')
        .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
        .eq('id', enrollment.id)
        .eq('status', 'active')
        .eq('current_step', enrollment.current_step);
      if (endError) {
        console.error(`[wa-skip] enrollment=${enrollment.id} falha ao encerrar:`, endError.message);
        continue;
      }

      await logLeadEvent(supabase, {
        orgId: enrollment.org_id,
        leadId: enrollment.lead_id,
        userId: null,
        event: 'cadence_completed',
        message: 'Cadência concluída — só restavam passos de WhatsApp e o lead está sem WhatsApp',
        metadata: {
          cadence_id: enrollment.cadence_id,
          enrollment_id: enrollment.id,
          reason: 'whatsapp_invalid_tail',
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
      console.warn(`[wa-skip] lead sem WhatsApp: ${advanced} avançada(s), ${ended} encerrada(s) por cauda de WhatsApp`);
    }
    return { scanned: candidates.length, advanced, ended };
  } catch (err) {
    console.error('[wa-skip] falha inesperada (motor segue):', err);
    return none;
  }
}
