import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { logLeadEvent } from '@/features/leads/actions/log-lead-event';

import { markLeadLostOnCadenceEnd } from './cadence-end-loss.service';
import {
  type MixedAutoEmailScope,
  type MixedCadenceRef,
  isMixedAutoEmailCadence,
  orgAllowsMixedAutoEmail,
} from './mixed-auto-email.service';
import { type CadenceStepChannel, classifyBlockedStep, isEmailStep } from './whatsapp-invalid-skip.service';

export interface SkipEnrollmentRef {
  id: string;
  cadence_id: string;
  lead_id: string;
  org_id: string;
  current_step: number;
}

/**
 * Só a cadência mista (standard, não-BDR, org na flag) pula o e-mail de lead
 * sem e-mail; auto_email/bdr_ai e passos de outros canais seguem como antes.
 */
export function shouldSkipEmailStepForNoLeadEmail(input: {
  stepChannel: string;
  leadEmail: string | null | undefined;
  cadence: MixedCadenceRef;
  scope: MixedAutoEmailScope;
  orgId: string;
}): boolean {
  return (
    input.stepChannel === 'email'
    && !input.leadEmail
    && isMixedAutoEmailCadence(input.cadence)
    && orgAllowsMixedAutoEmail(input.scope, input.orgId)
  );
}

/** 'skipped' = o UPDATE não atingiu linha (outra execução/SDR/pausa mexeu antes): nada gravado. */
export type SkipNoEmailResult = 'none' | 'advanced' | 'ended' | 'skipped' | 'error';

/**
 * Cadência mista, passo de e-mail e lead SEM e-mail: pula só o e-mail e segue
 * (antes o motor pausava a cadência inteira, com as ligações/WhatsApp depois).
 * Mesmo mecanismo do bounce (`skipBlockedSteps`): avança para o próximo passo
 * que não é e-mail, ou — se só restam e-mails — encerra e passa pela regra de
 * Perdido do fim de cadência. Nunca envia e nunca grava interação 'sent'.
 * Quem chama garante: cadência mista (standard, não-BDR) de org na flag.
 */
export async function skipEmailStepForLeadWithoutEmail(
  supabase: SupabaseClient,
  enrollment: SkipEnrollmentRef,
  steps: CadenceStepChannel[],
): Promise<SkipNoEmailResult> {
  try {
    const decision = classifyBlockedStep(steps, enrollment.current_step, isEmailStep);
    if (decision.action === 'none') return 'none';

    if (decision.action === 'advance') {
      // O trigger `calculate_next_step_due` recalcula o vencimento no UPDATE.
      const { data, error } = (await from(supabase, 'cadence_enrollments')
        .update({ current_step: decision.toStep } as Record<string, unknown>)
        .eq('id', enrollment.id)
        .eq('status', 'active')
        .eq('current_step', enrollment.current_step)
        .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };
      if (error) {
        console.error(`[email-skip] enrollment=${enrollment.id} falha ao avançar:`, error.message);
        return 'error';
      }
      if (data?.length !== 1) return 'skipped';
      await logLeadEvent(supabase, {
        orgId: enrollment.org_id,
        leadId: enrollment.lead_id,
        userId: null,
        event: 'step_skipped_email_no_lead_email',
        message: `Passo ${enrollment.current_step} (e-mail) pulado automaticamente — lead sem e-mail; cadência seguiu para o passo ${decision.toStep}`,
        metadata: {
          cadence_id: enrollment.cadence_id,
          enrollment_id: enrollment.id,
          from_step: enrollment.current_step,
          to_step: decision.toStep,
          reason: 'no_lead_email',
        },
      });
      return 'advanced';
    }

    // Só restam passos de e-mail: fim de cadência. Encerra ANTES da regra de
    // Perdido (ela recusa lead com cadência aberta).
    const { data: ended, error: endError } = (await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollment.id)
      .eq('status', 'active')
      .eq('current_step', enrollment.current_step)
      .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (endError) {
      console.error(`[email-skip] enrollment=${enrollment.id} falha ao encerrar:`, endError.message);
      return 'error';
    }
    if (ended?.length !== 1) return 'skipped';
    await logLeadEvent(supabase, {
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      userId: null,
      event: 'cadence_completed',
      message: 'Cadência concluída — só restavam passos de e-mail e o lead está sem e-mail',
      metadata: {
        cadence_id: enrollment.cadence_id,
        enrollment_id: enrollment.id,
        reason: 'no_lead_email_tail',
        last_step: enrollment.current_step,
      },
    });
    await markLeadLostOnCadenceEnd({
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      cadenceId: enrollment.cadence_id,
      enrollmentId: enrollment.id,
    });
    return 'ended';
  } catch (err) {
    console.error(`[email-skip] enrollment=${enrollment.id} falha inesperada:`, err);
    return 'error';
  }
}

/** 'step_gap' = faltou passo NO MEIO da cadência; 'skipped' = UPDATE sem linha atingida. */
export type CompleteNoStepResult = 'skipped_unloaded' | 'step_gap' | 'skipped' | 'completed' | 'error';

/**
 * Inscrição apontando para um passo que não existe. Só conclui (e perde o lead)
 * quando os passos DESTA cadência foram carregados e `current_step` está ALÉM
 * do último passo (cadência encurtada). Buraco no meio (`current_step <= max`
 * e ausente) não é seguro: não conclui nem perde. Ao concluir, segue o fim
 * normal: evento na timeline + `markLeadLostOnCadenceEnd` (mesmas guardas),
 * só se o UPDATE atingiu exatamente 1 linha.
 */
export async function completeEnrollmentWithoutStep(
  supabase: SupabaseClient,
  enrollment: SkipEnrollmentRef,
  loadedStepOrders: number[],
): Promise<CompleteNoStepResult> {
  if (loadedStepOrders.length === 0) return 'skipped_unloaded';
  if (enrollment.current_step <= Math.max(...loadedStepOrders)) return 'step_gap';
  try {
    const { data, error } = (await from(supabase, 'cadence_enrollments')
      .update({ status: 'completed', completed_at: new Date().toISOString() } as Record<string, unknown>)
      .eq('id', enrollment.id)
      .eq('status', 'active')
      .select('id')) as { data: Array<{ id: string }> | null; error: { message: string } | null };
    if (error) {
      console.error(`[cadence-engine] Failed to complete enrollment=${enrollment.id}:`, error.message);
      return 'error';
    }
    if (data?.length !== 1) return 'skipped';
    await logLeadEvent(supabase, {
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      userId: null,
      event: 'cadence_completed',
      message: 'Cadência concluída — a inscrição apontava para um passo que não existe mais',
      metadata: {
        cadence_id: enrollment.cadence_id,
        enrollment_id: enrollment.id,
        reason: 'no_step',
        last_step: enrollment.current_step,
      },
    });
    await markLeadLostOnCadenceEnd({
      orgId: enrollment.org_id,
      leadId: enrollment.lead_id,
      cadenceId: enrollment.cadence_id,
      enrollmentId: enrollment.id,
    });
    return 'completed';
  } catch (err) {
    console.error(`[cadence-engine] enrollment=${enrollment.id} falha inesperada ao concluir sem passo:`, err);
    return 'error';
  }
}
