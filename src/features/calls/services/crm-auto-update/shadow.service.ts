import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import type { FlagRow } from '@/features/contact-engine/services/flag-scope.service';

import { readAiOutcome } from '../../ai-outcome';
import {
  CRM_AUTO_UPDATE_FLAG_KEY,
  CRM_AUTO_UPDATE_LIVE_FLAG_KEY,
  CRM_AUTO_UPDATE_LIVE_SOURCE,
  CRM_AUTO_UPDATE_QUALIFICATION_PROVIDER,
  CRM_AUTO_UPDATE_RULES_VERSION,
} from './constants';
import {
  type CrmAutoUpdateMode,
  type CrmDecision,
  type CrmDecisionInput,
  type LeadStatus,
  type ProposedChanges,
  decideCrmAutoUpdate,
  resolveCrmAutoUpdateMode,
  shouldApplyLiveVoicemail,
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
  /** Live: escreveu o desfecho no CRM e gravou o log com applied = true. */
  | 'applied'
  /** Live: o CRM já tinha o nosso marcador e faltava o log. Só o log foi gravado (applied = true). */
  | 'applied_recovered'
  /** Live: erro de banco no UPDATE de calls. Nada foi gravado, nem o log (o retry pode tentar de novo). */
  | 'crm_write_failed'
  | 'log_failed';

/** Chave em calls.metadata. Distinta de metadata.ai_outcome (fluxo antigo do Power Dialer). */
export const CRM_AUTO_UPDATE_METADATA_KEY = 'crm_auto_update';

/** Marcador gravado em calls.metadata.crm_auto_update no MESMO UPDATE que preenche sdr_disposition. */
export interface CrmAutoUpdateMarker {
  applied: true;
  /** Desfecho escrito: voicemail (JEV) ou no_answer (hangup_v1). */
  disposition: 'voicemail' | 'no_answer';
  applied_at: string;
  /** Presente na escrita JEV. Ausente ou nulo no caminho hangup (sem qualificação). */
  qualification_id?: string | null;
  rules_version: string;
  source: string;
}

/** O que o live escreve: caixa postal, nova tentativa pela cadência, lead sem mudança. */
const LIVE_VOICEMAIL_PROPOSAL: ProposedChanges = {
  disposition: 'voicemail',
  next_activity: { type: 'retry', channel: 'phone' },
  lead_status: null,
};

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

/** Marcador da escrita live em calls.metadata, ou null quando não fomos nós que escrevemos. */
export function readCrmAutoUpdateMarker(metadata: unknown): Partial<CrmAutoUpdateMarker> | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>)[CRM_AUTO_UPDATE_METADATA_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const marker = raw as Partial<CrmAutoUpdateMarker>;
  return marker.applied === true ? marker : null;
}

/** A ligação já tem a NOSSA escrita (marcador + disposition voicemail)? */
function hasOwnLiveWrite(call: Pick<CallState, 'sdr_disposition' | 'metadata'>): Partial<CrmAutoUpdateMarker> | null {
  if (call.sdr_disposition !== 'voicemail') return null;
  return readCrmAutoUpdateMarker(call.metadata);
}

/** Linha gravada no log, a partir da decisão pura. */
export function buildShadowLogRow(args: {
  call: CallState;
  qualification: QualificationState;
  mode: Exclude<CrmAutoUpdateMode, 'off'>;
  decision: CrmDecision;
  leadStatus: LeadStatus | null;
  legacyApplied: boolean;
  /** Escrita live feita. Só com mode = 'live' e verdict = 'would_apply' (CHECK da migration). */
  applied?: boolean;
  applied_at?: string | null;
  /** Campos extras no input_snapshot (ex.: recuperação pelo marcador). */
  snapshotExtra?: Record<string, unknown>;
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
    applied: args.applied ?? false,
    applied_at: args.applied ? (args.applied_at ?? null) : null,
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
      ...args.snapshotExtra,
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
 * Modo live: grava o log como no shadow (mode = 'live') e escreve no CRM SÓ quando
 * shouldApplyLiveVoicemail aprova (outcome JEV 'voicemail', would_apply, confiança >= 0,85).
 * Única escrita fora do log: UPDATE condicional em calls (sdr_disposition IS NULL) com
 * sdr_disposition = 'voicemail' e o marcador metadata.crm_auto_update. Nunca cria atividade,
 * nunca muda leads.status, nunca escreve em interactions.
 *
 * Ordem: UPDATE em calls primeiro, depois o INSERT do log já com applied = true (o log é
 * append-only, não dá para marcar depois). Se o UPDATE falha, nada é gravado. Se o INSERT
 * do log falha depois do UPDATE, a próxima execução acha o marcador e grava só o log.
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
  const confidence = qualification.confidence === null ? null : Number(qualification.confidence);
  const decisionInput = (sdrDisposition: string | null): CrmDecisionInput => ({
    mode,
    qualification: {
      status: qualification.status,
      outcome: qualification.outcome,
      next_step_suggestion: qualification.next_step_suggestion,
      confidence,
      needs_review: qualification.needs_review,
    },
    call: {
      lead_id: call.lead_id,
      sdr_disposition: sdrDisposition,
      legacy_ai_outcome_applied: legacyApplied,
    },
    lead: leadStatus ? { status: leadStatus } : null,
    transcript_text: transcriptText,
    qualification_summary: qualification.summary ?? null,
  });

  const insertLog = async (row: Record<string, unknown>, okResult: CrmAutoUpdateRunResult) => {
    const res = (await from(db, CRM_SHADOW_LOG_TABLE).insert(row)) as {
      error?: { code?: string; message?: string } | null;
    };
    if (res.error) {
      // Corrida com outra execução: a linha única já existe.
      if (res.error.code === '23505') return 'already_logged' as const;
      console.error(
        `[crm-auto-update] falha ao gravar log da ligação ${call.id}: ${res.error.message ?? 'unknown'}` +
          (row.applied ? ' (CRM já escrito; o marcador em calls.metadata permite recuperar o log)' : ''),
      );
      return 'log_failed' as const;
    }
    return okResult;
  };

  /**
   * Recuperação: o CRM já tem a NOSSA escrita (marcador) e o log ainda não existe. Não
   * escreve no CRM de novo; grava só o log com applied = true e o applied_at do marcador.
   * A decisão é recalculada com o estado de ANTES da escrita (sdr_disposition nulo).
   */
  const logRecovered = (marker: Partial<CrmAutoUpdateMarker>) => {
    const before = decideCrmAutoUpdate({ ...decisionInput(null), mode: 'live' });
    const decision: CrmDecision = {
      verdict: 'would_apply',
      proposed: before.proposed ?? LIVE_VOICEMAIL_PROPOSAL,
      skip_reason: null,
      opt_out: before.opt_out,
    };
    const row = buildShadowLogRow({
      call: { ...call, sdr_disposition: null },
      qualification,
      mode: 'live',
      decision,
      leadStatus,
      legacyApplied,
      applied: true,
      applied_at: typeof marker.applied_at === 'string' ? marker.applied_at : new Date().toISOString(),
      snapshotExtra: { recovered_from_marker: true },
    });
    return insertLog(row, 'applied_recovered');
  };

  const ownWrite = hasOwnLiveWrite(call);
  if (ownWrite) return logRecovered(ownWrite);

  const decision = decideCrmAutoUpdate(decisionInput(call.sdr_disposition));

  if (!shouldApplyLiveVoicemail({ mode, decision, outcome: qualification.outcome, confidence })) {
    return insertLog(buildShadowLogRow({ call, qualification, mode, decision, leadStatus, legacyApplied }), 'logged');
  }

  // Escrita live: UPDATE condicional PRIMEIRO, com o marcador no mesmo UPDATE.
  const appliedAt = new Date().toISOString();
  const marker: CrmAutoUpdateMarker = {
    applied: true,
    disposition: 'voicemail',
    applied_at: appliedAt,
    qualification_id: qualification.id,
    rules_version: CRM_AUTO_UPDATE_RULES_VERSION,
    source: CRM_AUTO_UPDATE_LIVE_SOURCE,
  };
  const upd = (await from(db, 'calls')
    .update({
      sdr_disposition: 'voicemail',
      metadata: { ...(call.metadata ?? {}), [CRM_AUTO_UPDATE_METADATA_KEY]: marker },
      updated_at: appliedAt,
    })
    .eq('id', call.id)
    .eq('org_id', call.org_id)
    .is('sdr_disposition', null)
    .select('id')) as { data: Array<{ id: string }> | null; error?: { message?: string } | null };
  if (upd.error) {
    // Sem log: o retry decide de novo do zero.
    console.error(`[crm-auto-update] falha ao escrever desfecho da ligação ${call.id}: ${upd.error.message ?? 'unknown'}`);
    return 'crm_write_failed';
  }

  if (!upd.data || upd.data.length === 0) {
    // SDR (ou outra execução) chegou na frente. Nunca força. Se foi outra execução nossa,
    // o marcador está lá e o log precisa dizer applied = true.
    const { data: now } = (await from(db, 'calls')
      .select('id, org_id, lead_id, sdr_disposition, metadata')
      .eq('id', call.id)
      .single()) as { data: CallState | null };
    const concurrent = now ? hasOwnLiveWrite(now) : null;
    if (concurrent) return logRecovered(concurrent);
    const skipped: CrmDecision = {
      verdict: 'skip',
      proposed: decision.proposed,
      skip_reason: 'already_dispositioned',
      opt_out: decision.opt_out,
    };
    return insertLog(
      buildShadowLogRow({
        call: now ? { ...call, sdr_disposition: now.sdr_disposition } : call,
        qualification,
        mode,
        decision: skipped,
        leadStatus,
        legacyApplied,
        snapshotExtra: { live_write_conflict: true },
      }),
      'logged',
    );
  }

  return insertLog(
    buildShadowLogRow({
      call,
      qualification,
      mode,
      decision,
      leadStatus,
      legacyApplied,
      applied: true,
      applied_at: appliedAt,
    }),
    'applied',
  );
}
