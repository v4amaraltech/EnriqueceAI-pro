import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import type { FlagRow } from '@/features/contact-engine/services/flag-scope.service';

import { readAiOutcome } from '../../ai-outcome';
import {
  CRM_AUTO_UPDATE_FLAG_KEY,
  CRM_AUTO_UPDATE_LIVE_FLAG_KEY,
  CRM_AUTO_UPDATE_QUALIFICATION_PROVIDER,
  CRM_AUTO_UPDATE_RULES_VERSION,
} from './constants';
import {
  type CrmAutoUpdateMode,
  type CrmDecision,
  type LeadStatus,
  decideCrmAutoUpdate,
  resolveCrmAutoUpdateMode,
} from './decision';
import { suggestOptOutActions } from './opt-out';

export const CRM_SHADOW_LOG_TABLE = 'crm_auto_update_shadow_log';

export type CrmAutoUpdateRunResult =
  | 'call_not_found'
  | 'off'
  | 'no_qualification'
  | 'qualification_not_ready'
  | 'already_logged'
  | 'logged'
  | 'log_failed';

interface CallState {
  id: string;
  org_id: string;
  lead_id: string | null;
  sdr_disposition: string | null;
  metadata: Record<string, unknown> | null;
}

interface QualificationState {
  id: string;
  status: string;
  outcome: string | null;
  next_step_suggestion: string | null;
  interest: string | null;
  confidence: number | null;
  needs_review: boolean;
  needs_review_reasons: string[] | null;
  summary?: string | null;
  transcript_id: string | null;
  updated_at: string | null;
}

async function readFlagRow(db: SupabaseClient, key: string): Promise<FlagRow | null> {
  const res = (await from(db, 'app_flags')
    .select('enabled, allow_org_ids, allow_user_ids')
    .eq('key', key)
    .limit(1)) as { data: FlagRow[] | null; error?: { message: string } | null };
  if (res.error) throw new Error(`app_flags read failed: ${res.error.message}`);
  return res.data?.[0] ?? null;
}

/** Modo da org. Qualquer erro de leitura vale como off (falha fechada). */
export async function readCrmAutoUpdateMode(db: SupabaseClient, orgId: string): Promise<CrmAutoUpdateMode> {
  try {
    const shadow = await readFlagRow(db, CRM_AUTO_UPDATE_FLAG_KEY);
    if (!shadow) return 'off';
    const live = await readFlagRow(db, CRM_AUTO_UPDATE_LIVE_FLAG_KEY);
    return resolveCrmAutoUpdateMode(shadow, live, orgId);
  } catch {
    return 'off';
  }
}

/** O fluxo antigo do Power Dialer já aplicou um desfecho da IA nesta ligação? */
export function legacyAiOutcomeApplied(metadata: unknown): boolean {
  const ai = readAiOutcome(metadata);
  return ai?.status === 'done' && ai.applied !== false && Boolean(ai.disposition);
}

/** Linha gravada no log, a partir da decisão pura. */
export function buildShadowLogRow(args: {
  call: CallState;
  qualification: QualificationState;
  mode: Exclude<CrmAutoUpdateMode, 'off'>;
  decision: CrmDecision;
  leadStatus: LeadStatus | null;
  legacyApplied: boolean;
}): Record<string, unknown> {
  const { call, qualification: q, decision } = args;
  const optOut = decision.opt_out;
  // Opt-out: só PROPOSTA documental (applied = false). Nada é suprimido, apagado ou gravado.
  const proposedChanges = optOut.requested
    ? {
        ...(decision.proposed ?? {}),
        opt_out: {
          requested: true,
          channels: optOut.channels,
          patterns: optOut.patterns,
          suggested_actions: suggestOptOutActions(optOut),
          applied: false,
        },
      }
    : decision.proposed;
  return {
    call_id: call.id,
    org_id: call.org_id,
    qualification_id: q.id,
    lead_id: call.lead_id,
    mode: args.mode,
    verdict: decision.verdict,
    skip_reason: decision.skip_reason,
    proposed_changes: proposedChanges,
    rules_version: CRM_AUTO_UPDATE_RULES_VERSION,
    input_snapshot: {
      outcome: q.outcome,
      next_step_suggestion: q.next_step_suggestion,
      interest: q.interest,
      confidence: q.confidence,
      needs_review: q.needs_review,
      needs_review_reasons: q.needs_review_reasons,
      sdr_disposition: call.sdr_disposition,
      legacy_ai_outcome_applied: args.legacyApplied,
      lead_status: args.leadStatus,
      opt_out_requested: optOut.requested,
      opt_out_channels: optOut.channels,
    },
    qualification_completed_at: q.updated_at,
  };
}

/**
 * Roda a atualização automática do CRM para uma ligação com qualificação concluída.
 *
 * Modo shadow: calcula a proposta e grava UMA linha em crm_auto_update_shadow_log.
 * NÃO escreve em calls, scheduled_activities, leads nem interactions.
 *
 * Modo live: nesta versão também só registra (mode = 'live' no log). A escrita no
 * CRM entra em PR próprio, depois de medir a concordância do shadow.
 *
 * Idempotente por ligação: UNIQUE (call_id) no log; uma segunda chamada não grava nada.
 */
export async function runCrmAutoUpdate(db: SupabaseClient, callId: string): Promise<CrmAutoUpdateRunResult> {
  const { data: call } = (await from(db, 'calls')
    .select('id, org_id, lead_id, sdr_disposition, metadata')
    .eq('id', callId)
    .single()) as { data: CallState | null };
  if (!call) return 'call_not_found';

  const mode = await readCrmAutoUpdateMode(db, call.org_id);
  if (mode === 'off') return 'off';

  const { data: quals } = (await from(db, 'call_qualifications')
    .select(
      'id, status, outcome, next_step_suggestion, interest, confidence, needs_review, needs_review_reasons, summary, transcript_id, updated_at',
    )
    .eq('call_id', call.id)
    .eq('provider', CRM_AUTO_UPDATE_QUALIFICATION_PROVIDER)
    .limit(1)) as { data: QualificationState[] | null };
  const qualification = quals?.[0];
  if (!qualification) return 'no_qualification';
  // Ainda pode concluir: não grava agora para não travar a linha única da ligação.
  if (qualification.status !== 'completed') return 'qualification_not_ready';

  const { data: existing } = (await from(db, CRM_SHADOW_LOG_TABLE)
    .select('id')
    .eq('call_id', call.id)
    .limit(1)) as { data: Array<{ id: string }> | null };
  if (existing?.[0]) return 'already_logged';

  let transcriptText: string | null = null;
  if (qualification.transcript_id) {
    const { data: t } = (await from(db, 'call_transcripts_v2')
      .select('text')
      .eq('id', qualification.transcript_id)
      .limit(1)) as { data: Array<{ text: string | null }> | null };
    transcriptText = t?.[0]?.text ?? null;
  }

  let leadStatus: LeadStatus | null = null;
  if (call.lead_id) {
    const { data: leads } = (await from(db, 'leads')
      .select('status')
      .eq('id', call.lead_id)
      .limit(1)) as { data: Array<{ status: LeadStatus }> | null };
    leadStatus = leads?.[0]?.status ?? null;
  }

  const legacyApplied = legacyAiOutcomeApplied(call.metadata);
  const decision = decideCrmAutoUpdate({
    mode,
    qualification: {
      status: qualification.status,
      outcome: qualification.outcome,
      next_step_suggestion: qualification.next_step_suggestion,
      confidence: qualification.confidence === null ? null : Number(qualification.confidence),
      needs_review: qualification.needs_review,
    },
    call: {
      lead_id: call.lead_id,
      sdr_disposition: call.sdr_disposition,
      legacy_ai_outcome_applied: legacyApplied,
    },
    lead: leadStatus ? { status: leadStatus } : null,
    transcript_text: transcriptText,
    qualification_summary: qualification.summary ?? null,
  });

  const row = buildShadowLogRow({ call, qualification, mode, decision, leadStatus, legacyApplied });
  const res = (await from(db, CRM_SHADOW_LOG_TABLE).insert(row)) as {
    error?: { code?: string; message?: string } | null;
  };
  if (res.error) {
    // Corrida com outra execução: a linha única já existe.
    if (res.error.code === '23505') return 'already_logged';
    console.error(`[crm-auto-update] falha ao gravar log da ligação ${call.id}: ${res.error.message ?? 'unknown'}`);
    return 'log_failed';
  }
  return 'logged';
}
