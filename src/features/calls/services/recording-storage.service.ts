import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchPublicHttps } from '@/lib/security/safe-url';
import { from } from '@/lib/supabase/from';

import { measureAudioSeconds } from './audio-duration';
import { mergeCallsMetadata } from './merge-calls-metadata';
import { lookupRecordingFromApi4Com } from './recover-recording.service';
import {
  classifyRecordingDuration,
  findReusedRecordingOwner,
  isDurationStable,
  type RecordingOwnerRow,
  type RecordingPersistStatus,
} from './recording-validation';

export const CALL_RECORDINGS_BUCKET = 'call-recordings';

/** Esperas entre tentativas quando o arquivo remoto ainda parece em gravação (worker tem maxDuration 120 s). */
export const DEFAULT_RETRY_DELAYS_MS = [3000, 4000, 5000];

/** Storage object path for a call's recording: `{org_id}/{call_id}.mp3`. */
export function callRecordingStoragePath(orgId: string, callId: string): string {
  return `${orgId}/${callId}.mp3`;
}

export interface DownloadedAudio {
  buffer: Buffer;
  etag: string | null;
  seconds: number | null;
}

/** Baixa e mede o áudio. Null quando a URL não responde. */
export async function downloadAudio(url: string): Promise<DownloadedAudio | null> {
  try {
    // Pista 9: http(s) em host público, redirects revalidados a cada salto.
    const response = await fetchPublicHttps(url, { signal: AbortSignal.timeout(30_000) });
    if (!response || !response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    return { buffer, etag: response.headers.get('etag'), seconds: await measureAudioSeconds(buffer) };
  } catch {
    return null;
  }
}

export interface PersistRecordingResult {
  ok: boolean;
  path?: string;
  alreadyStored?: boolean;
  reason?: string;
  status?: RecordingPersistStatus;
  audioSeconds?: number | null;
}

export interface PersistCallRow {
  id: string;
  org_id: string;
  recording_url: string | null;
  recording_storage_path: string | null;
  metadata: Record<string, unknown> | null;
  destination: string;
  started_at: string | null;
  created_at: string;
  user_id: string;
  origin: string | null;
  duration_seconds: number;
}

export const PERSIST_CALL_COLUMNS =
  'id, org_id, recording_url, recording_storage_path, metadata, destination, started_at, created_at, user_id, origin, duration_seconds';

/**
 * Mescla `patch` em `calls.metadata` no banco (merge_calls_metadata, metadata || patch).
 * Ler e regravar o objeto inteiro no JS apagava chaves gravadas em paralelo.
 */
export async function mergeCallMetadata(
  supabase: SupabaseClient,
  callId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await mergeCallsMetadata(supabase, callId, patch);
  if (error) console.error(`[recording-storage] falha ao mesclar metadata da ligação ${callId}: ${error}`);
}

/** Marca o resultado da validação na ligação (flag consultada pelo proxy e pelo reparo). */
export async function flagRecordingStatus(
  supabase: SupabaseClient,
  callId: string,
  status: RecordingPersistStatus,
  audioSeconds: number | null,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await mergeCallMetadata(supabase, callId, {
    recording_persist_status: status,
    recording_audio_seconds: audioSeconds === null ? null : Math.round(audioSeconds * 10) / 10,
    recording_persist_checked_at: new Date().toISOString(),
    ...extra,
  });
}

/** Sobe o áudio validado (upsert), aponta `recording_storage_path` e grava a flag. */
export async function uploadValidatedRecording(
  supabase: SupabaseClient,
  call: Pick<PersistCallRow, 'id' | 'org_id'>,
  audio: DownloadedAudio,
  status: RecordingPersistStatus,
  opts: { durableUrl?: string | null } = {},
): Promise<PersistRecordingResult> {
  const path = callRecordingStoragePath(call.org_id, call.id);
  const { error: uploadError } = await supabase.storage
    .from(CALL_RECORDINGS_BUCKET)
    .upload(path, audio.buffer, { upsert: true, contentType: 'audio/mpeg' });
  if (uploadError) return { ok: false, reason: `upload_failed: ${uploadError.message}` };

  const update: Record<string, unknown> = { recording_storage_path: path, updated_at: new Date().toISOString() };
  if (opts.durableUrl) update.recording_url = opts.durableUrl;
  await from(supabase, 'calls').update(update).eq('id', call.id);

  await flagRecordingStatus(supabase, call.id, status, audio.seconds, {
    recording_etag: audio.etag ?? null,
  });
  return { ok: true, path, status, audioSeconds: audio.seconds };
}

/** Lê o arquivo já gravado no Storage e mede a duração. */
export async function measureStoredRecording(supabase: SupabaseClient, path: string): Promise<number | null> {
  try {
    const { data, error } = await supabase.storage.from(CALL_RECORDINGS_BUCKET).download(path);
    if (error || !data) return null;
    return await measureAudioSeconds(Buffer.from(await (data as Blob).arrayBuffer()));
  } catch {
    return null;
  }
}

/**
 * Alguma OUTRA ligação do mesmo ramal (mesma org) já usa esta URL/eTag?
 * Listener do API4COM às vezes ainda serve a gravação da ligação anterior do ramal.
 */
export async function findOwnerOfRecording(
  supabase: SupabaseClient,
  call: Pick<PersistCallRow, 'id' | 'org_id' | 'origin' | 'destination'>,
  identity: { url: string | null; etag: string | null },
): Promise<string | null> {
  const select = 'id, org_id, origin, destination, recording_url, metadata';
  const others: RecordingOwnerRow[] = [];
  const scope = (q: ReturnType<typeof from>) => {
    let query = q.select(select).eq('org_id', call.org_id).neq('id', call.id);
    query = call.origin ? query.eq('origin', call.origin) : query.eq('destination', call.destination);
    return query;
  };

  if (identity.url) {
    const { data } = (await scope(from(supabase, 'calls')).eq('recording_url', identity.url).limit(5)) as {
      data: RecordingOwnerRow[] | null;
    };
    others.push(...(data ?? []));
  }
  if (identity.etag) {
    const { data } = (await scope(from(supabase, 'calls'))
      .eq('metadata->>recording_etag', identity.etag)
      .limit(5)) as { data: RecordingOwnerRow[] | null };
    others.push(...(data ?? []));
  }
  return findReusedRecordingOwner(call, others, identity);
}

export interface PersistOptions {
  force?: boolean;
  /** Esperas entre tentativas de download (teste injeta []). */
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Download a call's recording and persist it to our private Storage bucket so
 * it stays playable after the API4COM listener link expires.
 *
 * Só deve ser disparada no `channel-hangup` (ver `recording-trigger.ts`). Fluxo:
 * 1. Se já existe cópia no Storage: confirma a duração (flag `ok` ou medição);
 *    cópia ruim NÃO vale como `alreadyStored` e é sobrescrita após um download validado.
 * 2. URL viva: ignorada se outra ligação do mesmo ramal já a usa. Senão baixa e
 *    repete (backoff) enquanto a duração não bate e ainda cresce entre tentativas.
 * 3. Sem áudio válido: busca o link durável via API4COM e valida de novo.
 * 4. Só sobe para o Storage áudio que bate com `duration_seconds` (tolerância em
 *    `recording-validation.ts`). Caso contrário recusa e marca `mismatch`.
 *
 * Service-role client expected (Storage write + RLS bypass).
 */
export async function persistCallRecording(
  supabase: SupabaseClient,
  callId: string,
  opts: PersistOptions = {},
): Promise<PersistRecordingResult> {
  const { data: call } = (await from(supabase, 'calls')
    .select(PERSIST_CALL_COLUMNS)
    .eq('id', callId)
    .single()) as { data: PersistCallRow | null };

  if (!call) return { ok: false, reason: 'call_not_found' };

  const sleep = opts.sleep ?? defaultSleep;
  const delays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const callMeta = call.metadata ?? {};

  if (call.recording_storage_path && !opts.force) {
    if (callMeta.recording_persist_status === 'ok') {
      return { ok: true, path: call.recording_storage_path, alreadyStored: true, status: 'ok' };
    }
    if (callMeta.recording_persist_status !== 'mismatch') {
      const storedSeconds = await measureStoredRecording(supabase, call.recording_storage_path);
      const storedStatus = classifyRecordingDuration(storedSeconds, call.duration_seconds);
      if (storedStatus !== 'mismatch') {
        await flagRecordingStatus(supabase, call.id, storedStatus, storedSeconds);
        return { ok: true, path: call.recording_storage_path, alreadyStored: true, status: storedStatus };
      }
    }
    // Cópia existente não bate: segue para sobrescrever com um download validado.
  }

  // 1) URL viva, a menos que já pertença a outra ligação do mesmo ramal.
  let lastSeconds: number | null = null;
  let reusedBy: string | null = null;
  let liveUrl = call.recording_url;
  if (liveUrl) {
    reusedBy = await findOwnerOfRecording(supabase, call, { url: liveUrl, etag: null });
    if (reusedBy) liveUrl = null;
  }

  if (liveUrl) {
    let previous: number | null = null;
    for (let attempt = 0; attempt <= delays.length; attempt++) {
      const audio = await downloadAudio(liveUrl);
      if (audio) {
        lastSeconds = audio.seconds;
        const etagOwner = await findOwnerOfRecording(supabase, call, { url: null, etag: audio.etag });
        if (etagOwner) {
          reusedBy = etagOwner;
          break;
        }
        const status = classifyRecordingDuration(audio.seconds, call.duration_seconds);
        if (status !== 'mismatch') return uploadValidatedRecording(supabase, call, audio, status);
        // Duração estável e ainda errada: o arquivo está fechado, esperar não adianta.
        if (isDurationStable(previous, audio.seconds)) break;
        previous = audio.seconds;
      }
      const delay = delays[attempt];
      if (delay !== undefined) await sleep(delay);
    }
  }

  // 2) Link durável via API da API4COM (a URL do listener é efêmera/reusada).
  const durable = await lookupRecordingFromApi4Com(supabase, call as Parameters<typeof lookupRecordingFromApi4Com>[1]);
  if (durable && durable !== liveUrl) {
    const audio = await downloadAudio(durable);
    if (audio) {
      lastSeconds = audio.seconds;
      const status = classifyRecordingDuration(audio.seconds, call.duration_seconds);
      if (status !== 'mismatch') return uploadValidatedRecording(supabase, call, audio, status, { durableUrl: durable });
    }
  }

  // 3) Nada válido: recusa e deixa a flag. Não sobe arquivo conhecidamente ruim.
  if (lastSeconds !== null || reusedBy || call.recording_storage_path) {
    await flagRecordingStatus(supabase, call.id, 'mismatch', lastSeconds, {
      ...(reusedBy ? { recording_reused_from_call_id: reusedBy } : {}),
    });
    return { ok: false, reason: 'duration_mismatch', status: 'mismatch', audioSeconds: lastSeconds };
  }
  return { ok: false, reason: 'no_audio_available' };
}
