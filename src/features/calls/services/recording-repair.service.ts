import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import {
  downloadAudio,
  flagRecordingStatus,
  measureStoredRecording,
  PERSIST_CALL_COLUMNS,
  type PersistCallRow,
  uploadValidatedRecording,
} from './recording-storage.service';
import { lookupRecordingFromApi4Com } from './recover-recording.service';
import { classifyRecordingDuration } from './recording-validation';

export type RepairOutcome =
  | 'skipped_ok' // já validada (flag ok) ou cópia atual bate com a duração
  | 'skipped_not_candidate' // sem cópia e sem flag de problema: cabe ao persist-pending
  | 'would_repair' // dry-run: a cópia durável bate e seria gravada
  | 'repaired'
  | 'unrepairable'; // não achou áudio que bata com a duração

export interface RepairPageOptions {
  orgId: string;
  /** Último `id` da página anterior (keyset). */
  cursor?: string | null;
  limit?: number;
  /** Padrão false: dry-run, nada é gravado. */
  apply?: boolean;
  /** Ignora ligações criadas antes disto (ISO). */
  sinceIso?: string;
}

export interface RepairPageResult {
  scanned: number;
  nextCursor: string | null;
  counts: Record<RepairOutcome, number>;
  details: Array<{ callId: string; outcome: RepairOutcome; audioSeconds?: number | null }>;
}

export const REPAIR_DEFAULT_LIMIT = 25;
export const REPAIR_MAX_LIMIT = 100;

function emptyCounts(): Record<RepairOutcome, number> {
  return { skipped_ok: 0, skipped_not_candidate: 0, would_repair: 0, repaired: 0, unrepairable: 0 };
}

/**
 * Repara UMA ligação: mede a cópia atual, e se não bate busca o link durável,
 * valida a duração e faz upsert no Storage. Em dry-run nunca escreve.
 */
export async function repairCallRecording(
  supabase: SupabaseClient,
  call: PersistCallRow,
  apply: boolean,
): Promise<{ outcome: RepairOutcome; audioSeconds?: number | null }> {
  const meta = call.metadata ?? {};
  if (meta.recording_persist_status === 'ok') return { outcome: 'skipped_ok' };

  if (call.recording_storage_path) {
    const storedSeconds = await measureStoredRecording(supabase, call.recording_storage_path);
    const storedStatus = classifyRecordingDuration(storedSeconds, call.duration_seconds);
    if (storedStatus !== 'mismatch') {
      if (apply) await flagRecordingStatus(supabase, call.id, storedStatus, storedSeconds);
      return { outcome: 'skipped_ok', audioSeconds: storedSeconds };
    }
  } else if (meta.recording_persist_status !== 'mismatch') {
    return { outcome: 'skipped_not_candidate' };
  }

  const durable = await lookupRecordingFromApi4Com(supabase, call as Parameters<typeof lookupRecordingFromApi4Com>[1]);
  const audio = durable ? await downloadAudio(durable) : null;
  const status = audio ? classifyRecordingDuration(audio.seconds, call.duration_seconds) : 'mismatch';

  if (!audio || status === 'mismatch') {
    if (apply && call.recording_storage_path) {
      // Garante a flag para o proxy não servir a cópia ruim.
      await flagRecordingStatus(supabase, call.id, 'mismatch', null);
    }
    return { outcome: 'unrepairable', audioSeconds: audio?.seconds ?? null };
  }
  if (!apply) return { outcome: 'would_repair', audioSeconds: audio.seconds };

  const saved = await uploadValidatedRecording(supabase, call, audio, status, { durableUrl: durable });
  return { outcome: saved.ok ? 'repaired' : 'unrepairable', audioSeconds: audio.seconds };
}

/**
 * Uma página de reparo com paginação keyset por `id` (sem offset).
 * Idempotente: ligações com `recording_persist_status = 'ok'` são puladas.
 */
export async function repairRecordingsPage(
  supabase: SupabaseClient,
  opts: RepairPageOptions,
): Promise<RepairPageResult> {
  const limit = Math.min(Math.max(opts.limit ?? REPAIR_DEFAULT_LIMIT, 1), REPAIR_MAX_LIMIT);
  const apply = opts.apply === true;

  let query = from(supabase, 'calls')
    .select(PERSIST_CALL_COLUMNS)
    .eq('org_id', opts.orgId)
    .not('recording_url', 'is', null)
    .gt('duration_seconds', 0)
    .order('id', { ascending: true })
    .limit(limit);
  if (opts.cursor) query = query.gt('id', opts.cursor);
  if (opts.sinceIso) query = query.gte('created_at', opts.sinceIso);

  const { data } = (await query) as { data: PersistCallRow[] | null };
  const rows = data ?? [];

  const counts = emptyCounts();
  const details: RepairPageResult['details'] = [];
  for (const call of rows) {
    const result = await repairCallRecording(supabase, call, apply);
    counts[result.outcome]++;
    details.push({ callId: call.id, ...result });
  }

  const last = rows[rows.length - 1];
  return {
    scanned: rows.length,
    nextCursor: rows.length === limit && last ? last.id : null,
    counts,
    details,
  };
}
