/**
 * Reparo de gravações cuja cópia no Storage não bate com `calls.duration_seconds`.
 * Não roda no CI e não grava sem --apply (dry-run por padrão).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm dlx tsx scripts/repair-mismatched-recordings.ts --org <uuid>
 *
 *   pnpm dlx tsx scripts/repair-mismatched-recordings.ts --org <uuid> --apply
 *   pnpm dlx tsx scripts/repair-mismatched-recordings.ts --org <uuid> --apply \
 *     --from-cursor <id> --limit 25 --days 90
 *   pnpm dlx tsx scripts/repair-mismatched-recordings.ts --org <uuid> --since 2026-10-12
 *
 * Janela: --days N (padrão 90) ou --since <ISO> (data ou timestamp; prevalece sobre --days).
 *
 * Limite da API4COM: 15 GET /calls por minuto por token. O script nunca passa disso:
 *   --rate N   requisições por minuto (1 a 15; padrão API4COM_CALLS_PER_MINUTE ou 15).
 * Em 429 respeita RateLimit-Reset / Retry-After e repete com backoff. Ordem por
 * ligação: recording_url salvo, depois id do provedor, só então a janela paginada.
 *
 * Execução longa (horas) e retomada:
 *   --state <arquivo.json>  grava cursor e totais depois de CADA ligação; se o
 *                           arquivo existe (e não há --from-cursor), retoma dele.
 *   Ctrl+C (SIGINT/SIGTERM) termina a ligação em curso, grava o estado e imprime
 *   o --from-cursor para retomar.
 *
 * Paginação keyset por id (sem offset). O log imprime o cursor para retomar.
 * Idempotente: ligações já validadas (metadata.recording_persist_status = 'ok') são puladas.
 * Equivalente HTTP: /api/cron/repair-mismatched-recordings (não está no vercel.json).
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import {
  type RepairSource,
  repairRecordingsPage,
  resolveRepairSinceIso,
} from '../src/features/calls/services/recording-repair.service';
import {
  API4COM_CALLS_MAX_PER_MINUTE,
  setApi4ComCallsPerMinute,
} from '../src/features/integrations/services/api4com-rate-limit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]) {
  if (argv.includes('--execute')) {
    throw new Error('--execute não é uma flag deste script. Use --apply para gravar.');
  }
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const rateRaw = get('--rate');
  const rate = rateRaw === undefined ? null : Number(rateRaw);
  if (
    rate !== null &&
    (!Number.isInteger(rate) || rate < 1 || rate > API4COM_CALLS_MAX_PER_MINUTE)
  ) {
    throw new Error(
      `--rate inválido: ${rateRaw}. Use um inteiro de 1 a ${API4COM_CALLS_MAX_PER_MINUTE} (teto da API4COM).`,
    );
  }
  const since = get('--since');
  if (since !== undefined && Number.isNaN(Date.parse(since))) {
    throw new Error(
      `--since inválido: ${since}. Use ISO, ex.: 2026-10-12 ou 2026-10-12T03:00:00Z.`,
    );
  }
  return {
    org: get('--org'),
    apply: argv.includes('--apply'),
    cursor: get('--from-cursor') ?? null,
    limit: Number(get('--limit') ?? 25) || 25,
    days: Number(get('--days') ?? 90) || 90,
    since: since ?? null,
    rate,
    state: get('--state') ?? null,
  };
}

export interface RepairState {
  org: string;
  apply: boolean;
  cursor: string | null;
  totals: Record<string, number>;
  sources: Record<RepairSource, number>;
  /** A rodada chegou ao fim (não há o que retomar). */
  finished?: boolean;
  updatedAt: string;
}

/** Estado salvo por uma rodada anterior (null se não existe). Recusa org ou modo diferente. */
export function loadState(
  path: string,
  expected: { org: string; apply: boolean },
  read: (p: string) => string | null = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null),
): RepairState | null {
  const raw = read(path);
  if (raw === null) return null;
  const state = JSON.parse(raw) as RepairState;
  if (state.org !== expected.org || state.apply !== expected.apply) {
    throw new Error(
      `--state ${path} é de outra rodada (org ${state.org}, apply ${state.apply}). Use outro arquivo.`,
    );
  }
  if (state.finished) {
    throw new Error(`--state ${path} é de uma rodada já concluída. Use outro arquivo.`);
  }
  return state;
}

/** Grava via arquivo temporário + rename, para não deixar JSON pela metade. */
export function saveState(path: string, state: RepairState): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

async function main() {
  let args: ReturnType<typeof parseArgs>;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  if (!args.org || !UUID.test(args.org)) {
    console.error(
      'Uso: --org <uuid> [--apply] [--from-cursor <id>] [--limit N] [--days N | --since <ISO>] ' +
        '[--rate N] [--state <arquivo.json>]',
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.');
    process.exit(1);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const sinceIso = resolveRepairSinceIso({ since: args.since, days: args.days }) ?? undefined;
  const org = args.org;
  const ratePerMinute = setApi4ComCallsPerMinute(
    args.rate ?? Number(process.env.API4COM_CALLS_PER_MINUTE ?? API4COM_CALLS_MAX_PER_MINUTE),
  );

  const previous = args.state ? loadState(args.state, { org, apply: args.apply }) : null;
  let cursor = args.cursor ?? previous?.cursor ?? null;
  const totals: Record<string, number> = { ...(previous?.totals ?? {}) };
  const totalSources: Record<RepairSource, number> = {
    recording_url: 0,
    api4com: 0,
    ...(previous?.sources ?? {}),
  };

  console.warn(
    args.apply ? 'MODO APPLY: vai gravar no Storage.' : 'DRY-RUN: nada será gravado (use --apply).',
  );
  console.warn(
    `API4COM: até ${ratePerMinute} GET /calls por minuto. ` +
      (previous && !args.cursor ? `Retomando de ${args.state} (cursor ${cursor ?? '-'}).` : ''),
  );

  let stopRequested = false;
  const requestStop = () => {
    if (stopRequested) process.exit(130);
    stopRequested = true;
    console.warn('Parando depois da ligação em curso (Ctrl+C de novo encerra na hora)...');
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

  const persist = (finished = false) => {
    if (!args.state) return;
    saveState(args.state, {
      org,
      apply: args.apply,
      cursor,
      totals,
      sources: totalSources,
      ...(finished ? { finished } : {}),
      updatedAt: new Date().toISOString(),
    });
  };

  const startedAt = Date.now();
  let processed = 0;
  for (;;) {
    const page = await repairRecordingsPage(supabase, {
      orgId: org,
      cursor,
      limit: args.limit,
      apply: args.apply,
      sinceIso,
      shouldStop: () => stopRequested,
      onCallDone: (callId, result) => {
        // Cursor e totais por ligação: uma interrupção perde no máximo a ligação em curso.
        cursor = callId;
        totals[result.outcome] = (totals[result.outcome] ?? 0) + 1;
        if (result.source && (result.outcome === 'would_repair' || result.outcome === 'repaired')) {
          totalSources[result.source]++;
        }
        processed++;
        persist();
      },
    });
    const minutes = ((Date.now() - startedAt) / 60_000).toFixed(1);
    console.warn(
      `scanned=${page.scanned} counts=${JSON.stringify(page.counts)} sources=${JSON.stringify(page.sources)} ` +
        `nextCursor=${page.nextCursor ?? '-'} processadas=${processed} minutos=${minutes}`,
    );
    if (page.stopped) {
      persist();
      console.warn(`Interrompido. Retome com: --from-cursor ${page.nextCursor ?? '-'}`);
      break;
    }
    if (!page.nextCursor) {
      persist(true);
      break;
    }
    cursor = page.nextCursor;
  }
  console.warn(`TOTAL counts=${JSON.stringify(totals)} sources=${JSON.stringify(totalSources)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
