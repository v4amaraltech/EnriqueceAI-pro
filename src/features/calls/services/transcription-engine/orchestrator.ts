import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPublicHttps } from '@/lib/security/safe-url';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { lookupRecordingFromApi4Com } from '../recover-recording.service';
import {
  type AssemblyAiClient,
  computeAssemblyAiCostUsd,
  createAssemblyAiClient,
} from './assemblyai.client';
import { type MonoAudio, assessAudioDuration, prepareMonoAudio } from './audio';
import {
  DURATION_MISMATCH_PREFIX,
  DURATION_WARNING_PREFIX,
  ENGINE_MIN_DURATION_SECONDS,
  ENGINE_PROVIDER_QUALIFICATION,
  ENGINE_PROVIDER_TRANSCRIPT,
  MAX_ATTEMPTS,
} from './constants';
import { isTranscriptionEngineEnabled } from './flag';
import { type JevClient, createJevClient, resolveJevApiKey } from './jev.client';
import { hasDurationWarning } from './review';

/** `processing` parado há mais que isso é execução que morreu. */
const STALE_PROCESSING_MS = 15 * 60 * 1000;

export type EngineOutcome =
  | 'call_not_found'
  | 'flag_off'
  | 'not_eligible'
  | 'skipped'
  | 'in_progress'
  | 'gave_up'
  | 'transcript_failed'
  | 'qualification_failed'
  | 'completed';

export interface EngineDeps {
  db: SupabaseClient;
  isEnabled: (orgId: string) => Promise<boolean>;
  downloadAudio: (url: string) => Promise<Buffer | null>;
  lookupRecording: (call: CallRow) => Promise<string | null>;
  prepareAudio: (input: Buffer) => Promise<MonoAudio>;
  assemblyAi: () => AssemblyAiClient | null;
  jev: () => JevClient | null;
  now: () => number;
}

export interface CallRow {
  id: string;
  org_id: string;
  user_id: string;
  recording_url: string | null;
  duration_seconds: number | null;
  answered_at: string | null;
  started_at: string | null;
  created_at: string;
  destination: string;
  origin: string | null;
  type: string | null;
  metadata: Record<string, string> | null;
}

interface EngineRow {
  id: string;
  status: string;
  attempts: number;
  updated_at: string | null;
  text?: string | null;
  utterances?: unknown;
  error?: string | null;
  speakers_count?: number | null;
}

const CALL_COLUMNS =
  'id, org_id, user_id, recording_url, duration_seconds, answered_at, started_at, created_at, destination, origin, type, metadata';

async function defaultDownload(url: string): Promise<Buffer | null> {
  try {
    const res = await fetchPublicHttps(url, { signal: AbortSignal.timeout(60_000) });
    if (!res || !res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export function defaultEngineDeps(db: SupabaseClient): EngineDeps {
  return {
    db,
    isEnabled: isTranscriptionEngineEnabled,
    downloadAudio: defaultDownload,
    lookupRecording: (call) =>
      lookupRecordingFromApi4Com(db, { ...call, duration_seconds: call.duration_seconds ?? 0 }),
    prepareAudio: prepareMonoAudio,
    assemblyAi: () => {
      const apiKey = process.env.ASSEMBLYAI_API_KEY;
      return apiKey ? createAssemblyAiClient({ apiKey }) : null;
    },
    jev: () => {
      const apiKey = resolveJevApiKey();
      return apiKey ? createJevClient({ apiKey }) : null;
    },
    now: () => Date.now(),
  };
}

type Table = 'call_transcripts_v2' | 'call_qualifications';
type Claim =
  | { row: EngineRow }
  | { blocked: 'in_progress' | 'gave_up' | 'completed'; row?: EngineRow };

/**
 * Reserva a linha (call_id, provider). Uma linha por par: status transita
 * pending/failed -> processing -> completed|failed|skipped. Nunca apaga.
 * Reserva otimista: o UPDATE só vale se o status ainda for o lido.
 */
async function claim(
  deps: EngineDeps,
  table: Table,
  call: CallRow,
  provider: string,
  extra: Record<string, unknown> = {},
): Promise<Claim> {
  const { data } = (await from(deps.db, table)
    .select('id, status, attempts, updated_at, text, utterances, error, speakers_count')
    .eq('call_id', call.id)
    .eq('provider', provider)
    .limit(1)) as { data: EngineRow[] | null };
  const existing = data?.[0];

  if (!existing) {
    const res = (await from(deps.db, table)
      .insert({
        call_id: call.id,
        org_id: call.org_id,
        provider,
        status: 'processing',
        attempts: 1,
        ...extra,
      })
      .select('id, status, attempts, updated_at')) as {
      data: EngineRow[] | null;
      error?: { code?: string } | null;
    };
    if (res.error || !res.data?.[0]) return { blocked: 'in_progress' };
    return { row: res.data[0] };
  }

  if (existing.status === 'completed' || existing.status === 'skipped') {
    return { blocked: 'completed', row: existing };
  }
  if (existing.status === 'processing') {
    const age = deps.now() - new Date(existing.updated_at ?? 0).getTime();
    if (age < STALE_PROCESSING_MS) return { blocked: 'in_progress' };
  }
  if (existing.attempts >= MAX_ATTEMPTS) return { blocked: 'gave_up', row: existing };

  const upd = (await from(deps.db, table)
    .update({ status: 'processing', attempts: existing.attempts + 1, error: null, ...extra })
    .eq('id', existing.id)
    .eq('status', existing.status)
    .select('id, status, attempts, updated_at')) as { data: EngineRow[] | null };
  if (!upd.data?.[0]) return { blocked: 'in_progress' };
  return { row: { ...existing, ...upd.data[0] } };
}

async function finish(
  deps: EngineDeps,
  table: Table,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await from(deps.db, table).update(patch).eq('id', id);
}

async function insertSkipped(deps: EngineDeps, call: CallRow, reason: string): Promise<void> {
  const { data } = (await from(deps.db, 'call_transcripts_v2')
    .select('id')
    .eq('call_id', call.id)
    .eq('provider', ENGINE_PROVIDER_TRANSCRIPT)
    .limit(1)) as { data: Array<{ id: string }> | null };
  if (data?.[0]) return;
  await from(deps.db, 'call_transcripts_v2').insert({
    call_id: call.id,
    org_id: call.org_id,
    provider: ENGINE_PROVIDER_TRANSCRIPT,
    status: 'skipped',
    error: reason,
  });
}

/** Resolve áudio por recording_url, depois por busca durável na API4COM. Nunca o Storage. */
async function fetchAndPrepare(
  deps: EngineDeps,
  call: CallRow,
  expectedSeconds: number,
): Promise<{ audio: MonoAudio; warning?: string } | { error: string; terminal: boolean }> {
  const tried = new Set<string>();
  let mismatch: string | null = null;
  // Áudio maior que o banco, aceitável: só vale se nenhum candidato der match justo.
  let fallback: { audio: MonoAudio; warning: string } | null = null;
  const candidates: Array<() => Promise<string | null>> = [
    async () => call.recording_url,
    () => deps.lookupRecording(call),
  ];
  for (const getUrl of candidates) {
    const url = await getUrl();
    if (!url || tried.has(url)) continue;
    tried.add(url);
    const buf = await deps.downloadAudio(url);
    if (!buf) continue;
    let audio: MonoAudio;
    try {
      audio = await deps.prepareAudio(buf);
    } catch (err) {
      return {
        error: `audio_decode_failed: ${err instanceof Error ? err.message : 'unknown'}`,
        terminal: false,
      };
    }
    const verdict = assessAudioDuration(expectedSeconds, audio.durationSeconds);
    const detail = `call=${expectedSeconds}s audio=${audio.durationSeconds.toFixed(1)}s`;
    if (verdict.accepted && !verdict.warning) return { audio };
    if (verdict.accepted) {
      fallback ??= { audio, warning: `${DURATION_WARNING_PREFIX}: ${detail}` };
    } else {
      mismatch = `${DURATION_MISMATCH_PREFIX}: ${detail}`;
    }
  }
  if (fallback) return fallback;
  if (mismatch) return { error: mismatch, terminal: true };
  return { error: 'no_recording', terminal: false };
}

/**
 * Transcreve (AssemblyAI) e qualifica (JEV) uma ligação atendida. Idempotente e
 * reexecutável: cada etapa só roda se a linha ainda não estiver completed.
 * Escreve apenas em call_transcripts_v2 e call_qualifications; calls é só leitura.
 */
export async function processEngineCall(
  callId: string,
  overrides: Partial<EngineDeps> = {},
): Promise<EngineOutcome> {
  const deps: EngineDeps = {
    ...defaultEngineDeps(overrides.db ?? createServiceRoleClient()),
    ...overrides,
  };

  const { data: call } = (await from(deps.db, 'calls')
    .select(CALL_COLUMNS)
    .eq('id', callId)
    .single()) as {
    data: CallRow | null;
  };
  if (!call) return 'call_not_found';
  if (!(await deps.isEnabled(call.org_id))) return 'flag_off';

  if (!call.answered_at) return 'not_eligible';
  const callSeconds = call.duration_seconds ?? 0;
  if (callSeconds < ENGINE_MIN_DURATION_SECONDS) {
    await insertSkipped(deps, call, 'duration_too_short');
    return 'skipped';
  }

  // Etapa 1: transcrição.
  const tClaim = await claim(deps, 'call_transcripts_v2', call, ENGINE_PROVIDER_TRANSCRIPT);
  let transcript: {
    id: string;
    text: string;
    utterances: unknown[];
    error?: string | null;
    speakersCount?: number | null;
  } | null = null;

  if (!('blocked' in tClaim)) {
    const started = deps.now();
    const rowId = tClaim.row.id;
    const prepared = await fetchAndPrepare(deps, call, callSeconds);
    if ('error' in prepared) {
      await finish(deps, 'call_transcripts_v2', rowId, {
        status: prepared.terminal ? 'skipped' : 'failed',
        error: prepared.error,
      });
      return prepared.terminal ? 'skipped' : 'transcript_failed';
    }
    const assembly = deps.assemblyAi();
    if (!assembly) {
      await finish(deps, 'call_transcripts_v2', rowId, {
        status: 'failed',
        error: 'assemblyai_not_configured',
      });
      return 'transcript_failed';
    }
    try {
      const result = await assembly.transcribe(prepared.audio.wav);
      // Cobrado sobre o áudio mono enviado; estéreo custaria 2x.
      const billedSeconds = result.audioSeconds || prepared.audio.durationSeconds;
      await finish(deps, 'call_transcripts_v2', rowId, {
        status: 'completed',
        // Aviso de duração (áudio maior que o banco) fica no error; sucesso sem aviso zera.
        error: prepared.warning ?? null,
        model: result.model,
        text: result.text,
        utterances: result.utterances,
        speakers_count: result.speakersCount,
        audio_seconds: billedSeconds,
        cost_usd: computeAssemblyAiCostUsd(billedSeconds),
        latency_ms: deps.now() - started,
      });
      transcript = {
        id: rowId,
        text: result.text,
        utterances: result.utterances,
        error: prepared.warning ?? null,
        speakersCount: result.speakersCount,
      };
    } catch (err) {
      await finish(deps, 'call_transcripts_v2', rowId, {
        status: 'failed',
        error: err instanceof Error ? err.message : 'assemblyai_unknown_error',
        latency_ms: deps.now() - started,
      });
      return 'transcript_failed';
    }
  } else if (tClaim.blocked === 'completed' && tClaim.row) {
    const r = tClaim.row;
    if (r.status === 'skipped') return 'skipped';
    transcript = {
      id: r.id,
      text: r.text ?? '',
      utterances: Array.isArray(r.utterances) ? r.utterances : [],
      error: r.error ?? null,
      speakersCount: r.speakers_count ?? null,
    };
  } else {
    return tClaim.blocked === 'gave_up' ? 'gave_up' : 'in_progress';
  }
  if (!transcript) return 'in_progress';

  // Etapa 2: qualificação.
  const qClaim = await claim(deps, 'call_qualifications', call, ENGINE_PROVIDER_QUALIFICATION, {
    transcript_id: transcript.id,
  });
  if ('blocked' in qClaim) {
    if (qClaim.blocked === 'completed') return 'completed';
    return qClaim.blocked === 'gave_up' ? 'gave_up' : 'in_progress';
  }
  const qId = qClaim.row.id;
  if (transcript.text.trim().length === 0) {
    await finish(deps, 'call_qualifications', qId, {
      status: 'skipped',
      error: 'empty_transcript',
    });
    return 'completed';
  }
  const jev = deps.jev();
  if (!jev) {
    await finish(deps, 'call_qualifications', qId, {
      status: 'failed',
      error: 'jev_not_configured',
    });
    return 'qualification_failed';
  }
  const qStarted = deps.now();
  try {
    const q = await jev.qualify({
      transcript: transcript.text,
      utterances: transcript.utterances as never,
      durationSeconds: callSeconds,
      callType: call.type === 'inbound' ? 'inbound' : 'outbound',
      durationWarning: hasDurationWarning(transcript.error),
      speakersCount: transcript.speakersCount,
    });
    await finish(deps, 'call_qualifications', qId, {
      status: 'completed',
      error: null,
      model: q.model,
      outcome: q.outcome,
      interest: q.interest,
      objections: q.objections,
      next_step_suggestion: q.nextStepSuggestion,
      summary: q.summary,
      answers: q.answers,
      confidence: q.confidence,
      needs_review: q.needsReview,
      needs_review_reasons: q.needsReviewReasons,
      cost_usd: q.costUsd,
      latency_ms: deps.now() - qStarted,
    });
    return 'completed';
  } catch (err) {
    await finish(deps, 'call_qualifications', qId, {
      status: 'failed',
      error: err instanceof Error ? err.message : 'jev_unknown_error',
      latency_ms: deps.now() - qStarted,
    });
    return 'qualification_failed';
  }
}

/** Ids de ligações com trabalho pendente: transcrição/qualificação pending, failed ou processing parado. */
export async function findDrainCandidates(
  db: SupabaseClient,
  limit: number,
  nowMs = Date.now(),
): Promise<string[]> {
  const staleBefore = new Date(nowMs - STALE_PROCESSING_MS).toISOString();
  const ids = new Set<string>();
  for (const table of ['call_transcripts_v2', 'call_qualifications'] as const) {
    const retry = (await from(db, table)
      .select('call_id')
      .in('status', ['pending', 'failed'])
      .lt('attempts', MAX_ATTEMPTS)
      .order('created_at', { ascending: true })
      .limit(limit)) as { data: Array<{ call_id: string }> | null };
    const stale = (await from(db, table)
      .select('call_id')
      .eq('status', 'processing')
      .lt('updated_at', staleBefore)
      .lt('attempts', MAX_ATTEMPTS)
      .limit(limit)) as { data: Array<{ call_id: string }> | null };
    for (const r of [...(retry.data ?? []), ...(stale.data ?? [])]) ids.add(r.call_id);
  }
  // Transcrição concluída sem linha de qualificação (worker morreu entre as etapas).
  const done = (await from(db, 'call_transcripts_v2')
    .select('call_id')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit * 3)) as { data: Array<{ call_id: string }> | null };
  const doneIds = (done.data ?? []).map((r) => r.call_id);
  if (doneIds.length) {
    const quals = (await from(db, 'call_qualifications')
      .select('call_id')
      .in('call_id', doneIds)) as {
      data: Array<{ call_id: string }> | null;
    };
    const have = new Set((quals.data ?? []).map((r) => r.call_id));
    for (const id of doneIds) if (!have.has(id)) ids.add(id);
  }
  return [...ids].slice(0, limit);
}
