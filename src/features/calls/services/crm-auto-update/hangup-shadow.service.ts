import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { mergeCallsMetadata } from '../merge-calls-metadata';
import {
  CRM_AUTO_UPDATE_HANGUP_RULES_VERSION,
  CRM_AUTO_UPDATE_HANGUP_SOURCE,
  CRM_AUTO_UPDATE_LIVE_HANGUP_DISPOSITION,
  CRM_AUTO_UPDATE_LIVE_HANGUP_NOT_CONNECTED_DISPOSITION,
  CRM_AUTO_UPDATE_LIVE_SOURCE,
} from './constants';
import type { CrmAutoUpdateMode } from './decision';
import {
  type HangupClassification,
  type HangupCrmDecision,
  type LiveHangupDisposition,
  classifyHangupForCrm,
  decideHangupCrm,
  liveHangupDispositionToApply,
} from './hangup-decision';
import {
  CRM_AUTO_UPDATE_METADATA_KEY,
  CRM_SHADOW_LOG_TABLE,
  type CrmAutoUpdateMarker,
  legacyAiOutcomeApplied,
  readCrmAutoUpdateMarker,
  readCrmAutoUpdateMode,
} from './shadow.service';

export type HangupCrmShadowResult =
  | 'call_not_found'
  | 'unmapped'
  | 'off'
  | 'already_logged'
  | 'logged'
  /** Live: escreveu sdr_disposition (no_answer ou technical_failure) e gravou o log com applied = true. */
  | 'applied'
  /** Live: o CRM já tinha o nosso marcador hangup_v1 e faltava o log. Só o log foi gravado. */
  | 'applied_recovered'
  /** Live: erro de banco no UPDATE de calls. Nada foi gravado, nem o log. */
  | 'crm_write_failed'
  | 'log_failed';

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

const LIVE_HANGUP_DISPOSITIONS: ReadonlySet<string> = new Set([
  CRM_AUTO_UPDATE_LIVE_HANGUP_DISPOSITION,
  CRM_AUTO_UPDATE_LIVE_HANGUP_NOT_CONNECTED_DISPOSITION,
]);

/** A ligação já tem a NOSSA escrita hangup_v1 (marcador + disposition no_answer ou technical_failure)? */
function hasOwnHangupLiveWrite(
  call: Pick<HangupCallState, 'sdr_disposition' | 'metadata'>,
): Partial<CrmAutoUpdateMarker> | null {
  if (!call.sdr_disposition || !LIVE_HANGUP_DISPOSITIONS.has(call.sdr_disposition)) return null;
  const marker = readCrmAutoUpdateMarker(call.metadata);
  if (!marker) return null;
  if (marker.disposition !== call.sdr_disposition) return null;
  if (marker.rules_version !== CRM_AUTO_UPDATE_HANGUP_RULES_VERSION) return null;
  return marker;
}

/** Linha do log para o caminho hangup. qualification_id sempre nulo (sem JEV). */
export function buildHangupShadowLogRow(args: {
  call: HangupCallState;
  classification: HangupClassification;
  decision: HangupCrmDecision;
  legacyApplied: boolean;
  mode: Exclude<CrmAutoUpdateMode, 'off'>;
  applied?: boolean;
  applied_at?: string | null;
  snapshotExtra?: Record<string, unknown>;
}): Record<string, unknown> {
  const { call, classification, decision } = args;
  const applied = args.applied ?? false;
  return {
    call_id: call.id,
    org_id: call.org_id,
    // Sem qualificação JEV neste caminho (coluna anulável desde a migration 20261112220000).
    qualification_id: null,
    qualification_completed_at: null,
    lead_id: call.lead_id,
    mode: args.mode,
    verdict: decision.verdict,
    skip_reason: decision.skip_reason,
    proposed_changes: decision.proposed,
    rules_version: CRM_AUTO_UPDATE_HANGUP_RULES_VERSION,
    applied,
    applied_at: applied ? (args.applied_at ?? null) : null,
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
      ...args.snapshotExtra,
    },
  };
}

/**
 * Grava em crm_auto_update_shadow_log a proposta do hangup determinístico (ver hangup-decision.ts).
 *
 * Modo shadow: a linha vai com mode = 'shadow' e applied = false. Nenhuma escrita fora do log.
 *
 * Modo live: escreve no CRM SÓ quando liveHangupDispositionToApply devolve um desfecho
 * (não atendeu: no_answer; número inválido ou falha técnica: technical_failure;
 * would_apply; org no allowlist live). Única escrita fora do log: UPDATE condicional
 * em calls (sdr_disposition IS NULL) com o desfecho correspondente e o marcador
 * metadata.crm_auto_update. ORIGINATOR_CANCEL e NORMAL_CLEARING atendida curta
 * não classificam (nada é gravado). Nunca cria atividade, nunca muda leads.status,
 * nunca escreve em interactions.
 *
 * Ordem: UPDATE em calls primeiro, depois o INSERT do log já com applied = true (o log é
 * append-only). Se o UPDATE falha, nada é gravado. Se o INSERT do log falha depois do UPDATE,
 * a próxima execução acha o marcador e grava só o log.
 *
 * Idempotente: UNIQUE (call_id) no log. Webhook e reconcile podem chamar de novo; a
 * segunda vez vira already_logged. Log append-only, sem UPDATE.
 */
export async function runHangupCrmShadow(
  db: SupabaseClient,
  callId: string,
): Promise<HangupCrmShadowResult> {
  const { data: call } = (await from(db, 'calls')
    .select(
      'id, org_id, lead_id, sdr_disposition, hangup_cause, answered_at, duration_seconds, connected, status, metadata',
    )
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

  const { data: existing } = (await from(db, CRM_SHADOW_LOG_TABLE)
    .select('id')
    .eq('call_id', call.id)
    .limit(1)) as { data: Array<{ id: string }> | null };
  if (existing?.[0]) return 'already_logged';

  const legacyApplied = legacyAiOutcomeApplied(call.metadata);

  const insertLog = async (row: Record<string, unknown>, okResult: HangupCrmShadowResult) => {
    const res = (await from(db, CRM_SHADOW_LOG_TABLE).insert(row)) as {
      error?: { code?: string; message?: string } | null;
    };
    if (res.error) {
      const msg = res.error.message ?? '';
      if (res.error.code === '23505' || /unique|duplicate/i.test(msg))
        return 'already_logged' as const;
      console.error(
        `[crm-auto-update:hangup] falha ao gravar log da ligação ${call.id}: ${msg || 'unknown'}` +
          (row.applied
            ? ' (CRM já escrito; o marcador em calls.metadata permite recuperar o log)'
            : ''),
      );
      return 'log_failed' as const;
    }
    return okResult;
  };

  /**
   * Recuperação: o CRM já tem a NOSSA escrita hangup_v1 (marcador) e o log ainda não existe.
   * Não escreve no CRM de novo; grava só o log com applied = true e o applied_at do marcador.
   * A decisão é recalculada com o estado de ANTES da escrita (sdr_disposition nulo).
   */
  const logRecovered = (marker: Partial<CrmAutoUpdateMarker>) => {
    const before = decideHangupCrm({
      classification,
      call: {
        lead_id: call.lead_id,
        sdr_disposition: null,
        legacy_ai_outcome_applied: legacyApplied,
      },
    });
    const decision: HangupCrmDecision = {
      verdict: 'would_apply',
      proposed: before.proposed,
      skip_reason: null,
    };
    const row = buildHangupShadowLogRow({
      call: { ...call, sdr_disposition: null },
      classification,
      decision,
      legacyApplied,
      mode: 'live',
      applied: true,
      applied_at:
        typeof marker.applied_at === 'string' ? marker.applied_at : new Date().toISOString(),
      snapshotExtra: { recovered_from_marker: true },
    });
    return insertLog(row, 'applied_recovered');
  };

  const ownWrite = hasOwnHangupLiveWrite(call);
  if (ownWrite) return logRecovered(ownWrite);

  const decision = decideHangupCrm({
    classification,
    call: {
      lead_id: call.lead_id,
      sdr_disposition: call.sdr_disposition,
      legacy_ai_outcome_applied: legacyApplied,
    },
  });

  const liveDisposition: LiveHangupDisposition | null = liveHangupDispositionToApply({
    mode,
    decision,
    classification,
  });
  if (!liveDisposition) {
    return insertLog(
      buildHangupShadowLogRow({ call, classification, decision, legacyApplied, mode }),
      'logged',
    );
  }

  // Escrita live: UPDATE condicional PRIMEIRO, com o marcador no mesmo UPDATE.
  const appliedAt = new Date().toISOString();
  const marker: CrmAutoUpdateMarker = {
    applied: true,
    disposition: liveDisposition,
    applied_at: appliedAt,
    rules_version: CRM_AUTO_UPDATE_HANGUP_RULES_VERSION,
    source: CRM_AUTO_UPDATE_LIVE_SOURCE,
  };
  // Merge atômico no banco: desfecho + marcador no MESMO UPDATE, guarda
  // sdr_disposition IS NULL, e o patch leva só o marcador (nunca o metadata lido).
  const upd = await mergeCallsMetadata(
    db,
    call.id,
    { [CRM_AUTO_UPDATE_METADATA_KEY]: marker },
    { orgId: call.org_id, sdrDisposition: liveDisposition, onlyIfDispositionNull: true },
  );
  if (upd.error) {
    console.error(
      `[crm-auto-update:hangup] falha ao escrever desfecho da ligação ${call.id}: ${upd.error}`,
    );
    return 'crm_write_failed';
  }

  if (!upd.updated) {
    // SDR (ou outra execução) chegou na frente. Nunca força. Se foi outra execução nossa,
    // o marcador está lá e o log precisa dizer applied = true.
    const { data: now } = (await from(db, 'calls')
      .select(
        'id, org_id, lead_id, sdr_disposition, hangup_cause, answered_at, duration_seconds, connected, status, metadata',
      )
      .eq('id', call.id)
      .single()) as { data: HangupCallState | null };
    const concurrent = now ? hasOwnHangupLiveWrite(now) : null;
    if (concurrent) return logRecovered(concurrent);
    const skipped: HangupCrmDecision = {
      verdict: 'skip',
      proposed: decision.proposed,
      skip_reason: 'already_dispositioned',
    };
    return insertLog(
      buildHangupShadowLogRow({
        call: now ? { ...call, sdr_disposition: now.sdr_disposition } : call,
        classification,
        decision: skipped,
        legacyApplied,
        mode,
        snapshotExtra: { live_write_conflict: true },
      }),
      'logged',
    );
  }

  return insertLog(
    buildHangupShadowLogRow({
      call,
      classification,
      decision,
      legacyApplied,
      mode: 'live',
      applied: true,
      applied_at: appliedAt,
    }),
    'applied',
  );
}

/** Fire-and-forget para o webhook e o reconcile. Nunca lança e não bloqueia o chamador. */
export function triggerHangupCrmShadow(db: SupabaseClient, callId: string): void {
  try {
    void runHangupCrmShadow(db, callId).catch((err: unknown) => {
      console.error(
        `[crm-auto-update:hangup] erro no caminho hangup da ligação ${callId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  } catch (err) {
    console.error(
      `[crm-auto-update:hangup] erro no caminho hangup da ligação ${callId}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
