import { NextResponse } from 'next/server';

import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { mergeCallsMetadata } from '@/features/calls/services/merge-calls-metadata';
import { persistCallRecording } from '@/features/calls/services/recording-storage.service';

export const maxDuration = 300;

// Calls whose recording lives only on API4COM (ephemeral listener URL that
// expires in hours). Persist them to our Storage so the player keeps working.
// Newest/oldest split mirrors recover-missing-recordings so a deep backlog
// doesn't starve the oldest items still inside API4COM's ~90d retention.
const BATCH_LIMIT_NEW = 25;
const BATCH_LIMIT_OLD = 25;
// Beyond ~90d the durable file is gone from API4COM (and dead listener URLs
// can't be re-resolved), so persistence would just fail — cap to stay useful.
const MAX_AGE_DAYS = 60;
// Espera antes de tentar de novo, pela quantidade de falhas: 1 h, 6 h, 24 h e, da 4ª em diante, 7 dias.
// Nada é dado como perdido: não sabemos separar "o áudio não existe" de "a consulta falhou".
const RETRY_WAIT_HOURS = [1, 6, 24];
const MAX_RETRY_WAIT_HOURS = 7 * 24;
// ISO em UTC (toISOString): a comparação de texto no banco segue a ordem das datas.
const RETRY_AT = 'metadata->>recording_persist_retry_at';

/**
 * Backfill: download recordings that have a recording_url but were never
 * persisted to our Storage bucket (recording_storage_path IS NULL), in batches.
 * persistCallRecording re-resolves a durable URL via the API4COM API when the
 * stored listener link has already expired. A cópia só é gravada se a duração do
 * áudio bater com calls.duration_seconds (ver recording-validation.ts). Forward calls are persisted by the
 * webhook (só no hangup); this drains the historical backlog and self-heals any misses.
 * Tentativa sem cópia (e sem `mismatch`) fica em espera crescente, para a fila andar.
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoffIso = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  type CallRow = { id: string; org_id: string; created_at: string; persist_attempts: string | null };

  const nowIso = new Date().toISOString();
  const baseQuery = () =>
    from(supabase, 'calls')
      .select('id, org_id, created_at, persist_attempts:metadata->>recording_persist_attempts')
      .is('recording_storage_path', null)
      .not('recording_url', 'is', null)
      // Já recusadas por duração divergente: quem trata é o reparo (repair-mismatched-recordings).
      .or('metadata->>recording_persist_status.is.null,metadata->>recording_persist_status.neq.mismatch')
      .gt('duration_seconds', 0)
      .gte('created_at', cutoffIso);

  // Quem está em espera fica fora. Em vez de um segundo .or() (o .or() do PostgREST já perdeu
  // ramo em prod), uma consulta para "nunca falhou" e outra para "a espera já venceu".
  const pick = async (ascending: boolean, limit: number): Promise<CallRow[]> => {
    const ordered = () => baseQuery().order('created_at', { ascending }).limit(limit);
    const results = (await Promise.all([
      ordered().is(RETRY_AT, null),
      ordered().lte(RETRY_AT, nowIso),
    ])) as unknown as Array<{ data: CallRow[] | null; error: { message?: string } | null }>;
    for (const { error } of results) {
      if (error) console.error('[persist-pending-recordings] select failed', error.message);
    }
    const direction = ascending ? 1 : -1;
    return results
      .flatMap((r) => r.data ?? [])
      .sort((a, b) => direction * (Date.parse(a.created_at) - Date.parse(b.created_at)))
      .slice(0, limit);
  };

  const [newest, oldest] = await Promise.all([pick(false, BATCH_LIMIT_NEW), pick(true, BATCH_LIMIT_OLD)]);

  const seen = new Set<string>();
  const calls: CallRow[] = [];
  for (const row of [...newest, ...oldest]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    calls.push(row);
  }

  if (calls.length === 0) {
    return NextResponse.json({ message: 'No recordings pending persistence', processed: 0 });
  }

  let persisted = 0;
  let noAudio = 0;
  let failed = 0;

  const scheduleRetry = async (call: CallRow) => {
    const attempts = (Number(call.persist_attempts) || 0) + 1;
    const hours = RETRY_WAIT_HOURS[attempts - 1] ?? MAX_RETRY_WAIT_HOURS;
    const { error } = await mergeCallsMetadata(
      supabase,
      call.id,
      {
        recording_persist_attempts: attempts,
        recording_persist_retry_at: new Date(Date.now() + hours * 60 * 60 * 1000).toISOString(),
      },
      { orgId: call.org_id },
    );
    if (error) console.error('[persist-pending-recordings] failed to schedule retry', call.id, error);
  };

  for (const call of calls) {
    try {
      const result = await persistCallRecording(supabase, call.id);
      if (result.ok) persisted++;
      else {
        noAudio++;
        if (result.status !== 'mismatch') await scheduleRetry(call);
      }
    } catch (err) {
      failed++;
      console.error('[persist-pending-recordings] error processing call', call.id, err);
      await scheduleRetry(call);
    }
  }

  return NextResponse.json({
    message: 'Recording persistence batch processed',
    total: calls.length,
    persisted,
    noAudio,
    failed,
  });
}

export async function GET(request: Request) {
  return POST(request);
}
