import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { CRM_AUTO_UPDATE_HANGUP_RULES_VERSION, CRM_AUTO_UPDATE_HANGUP_SOURCE } from './constants';
import { type HangupClassification, type HangupCrmDecision, classifyHangupForCrm, decideHangupCrm } from './hangup-decision';
import { CRM_SHADOW_LOG_TABLE, legacyAiOutcomeApplied, readCrmAutoUpdateMode } from './shadow.service';

export type HangupCrmShadowResult = 'call_not_found' | 'unmapped' | 'off' | 'already_logged' | 'logged' | 'log_failed';

interface HangupCallState {
  id: string;
  org_id: string;
  lead_id: string | null;
  sdr_disposition: string | null;
  hangup_cause: string | null;
  answered_at: string | null;
  duration_seconds: number | null;
  connected: boolean | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
}

/** Linha do log para o caminho hangup. Sempre mode = 'shadow' e applied = false. */
export function buildHangupShadowLogRow(args: {
  call: HangupCallState;
  classification: HangupClassification;
  decision: HangupCrmDecision;
  legacyApplied: boolean;
}): Record<string, unknown> {
  const { call, classification, decision } = args;
  return {
    call_id: call.id,
    org_id: call.org_id,
    // Sem qualificação JEV neste caminho (coluna anulável desde a migration 20261112220000).
    qualification_id: null,
    qualification_completed_at: null,
    lead_id: call.lead_id,
    mode: 'shadow',
    verdict: decision.verdict,
    skip_reason: decision.skip_reason,
    proposed_changes: decision.proposed,
    rules_version: CRM_AUTO_UPDATE_HANGUP_RULES_VERSION,
    applied: false,
    applied_at: null,
    input_snapshot: {
      source: CRM_AUTO_UPDATE_HANGUP_SOURCE,
      hangup_cause: classification.hangup_cause,
      answered_at: call.answered_at,
      duration_seconds: call.duration_seconds,
      connected: call.connected,
      status: call.status,
      sdr_disposition: call.sdr_disposition,
      outcome: classification.outcome,
      confidence: classification.confidence,
      legacy_ai_outcome_applied: args.legacyApplied,
    },
  };
}

/**
 * Grava em crm_auto_update_shadow_log a proposta do hangup determinístico (ver hangup-decision.ts).
 *
 * SÓ shadow: mesmo com a org em live, a linha vai com mode = 'shadow' e applied = false.
 * Nunca escreve em calls (nem metadata), leads, scheduled_activities ou interactions, e
 * nunca passa por shouldApplyLiveVoicemail. Portão de org: a flag crm_auto_update_v1.
 *
 * Idempotente: UNIQUE (call_id) no log. Webhook e reconcile podem chamar de novo; a
 * segunda vez vira already_logged. Log append-only, sem UPDATE.
 */
export async function runHangupCrmShadow(db: SupabaseClient, callId: string): Promise<HangupCrmShadowResult> {
  const { data: call } = (await from(db, 'calls')
    .select('id, org_id, lead_id, sdr_disposition, hangup_cause, answered_at, duration_seconds, connected, status, metadata')
    .eq('id', callId)
    .single()) as { data: HangupCallState | null };
  if (!call) return 'call_not_found';

  const classification = classifyHangupForCrm({
    hangupCause: call.hangup_cause,
    answeredAt: call.answered_at,
    durationSeconds: call.duration_seconds,
  });
  if (!classification) return 'unmapped';

  const mode = await readCrmAutoUpdateMode(db, call.org_id);
  if (mode === 'off') return 'off';

  const legacyApplied = legacyAiOutcomeApplied(call.metadata);
  const decision = decideHangupCrm({
    classification,
    call: { lead_id: call.lead_id, sdr_disposition: call.sdr_disposition, legacy_ai_outcome_applied: legacyApplied },
  });

  const res = (await from(db, CRM_SHADOW_LOG_TABLE).insert(
    buildHangupShadowLogRow({ call, classification, decision, legacyApplied }),
  )) as { error?: { code?: string; message?: string } | null };
  if (res.error) {
    const msg = res.error.message ?? '';
    if (res.error.code === '23505' || /unique|duplicate/i.test(msg)) return 'already_logged';
    console.error(`[crm-auto-update:hangup] falha ao gravar log da ligação ${call.id}: ${msg || 'unknown'}`);
    return 'log_failed';
  }
  return 'logged';
}

/** Fire-and-forget para o webhook e o reconcile. Nunca lança e não bloqueia o chamador. */
export function triggerHangupCrmShadow(db: SupabaseClient, callId: string): void {
  try {
    void runHangupCrmShadow(db, callId).catch((err: unknown) => {
      console.error(
        `[crm-auto-update:hangup] erro no log sombra da ligação ${callId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  } catch (err) {
    console.error(
      `[crm-auto-update:hangup] erro no log sombra da ligação ${callId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
