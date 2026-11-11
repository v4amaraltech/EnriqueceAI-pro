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
 * Paginação keyset por id (sem offset). O log imprime o cursor para retomar.
 * Idempotente: ligações já validadas (metadata.recording_persist_status = 'ok') são puladas.
 * Equivalente HTTP: /api/cron/repair-mismatched-recordings (não está no vercel.json).
 */
import { createClient } from '@supabase/supabase-js';

import {
  type RepairSource,
  repairRecordingsPage,
  resolveRepairSinceIso,
} from '../src/features/calls/services/recording-repair.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv: string[]) {
  if (argv.includes('--execute')) {
    throw new Error('--execute não é uma flag deste script. Use --apply para gravar.');
  }
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
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
  };
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
      'Uso: --org <uuid> [--apply] [--from-cursor <id>] [--limit N] [--days N | --since <ISO>]',
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

  console.warn(
    args.apply ? 'MODO APPLY: vai gravar no Storage.' : 'DRY-RUN: nada será gravado (use --apply).',
  );
  let cursor = args.cursor;
  const totals: Record<string, number> = {};
  const totalSources: Record<RepairSource, number> = { recording_url: 0, api4com: 0 };
  do {
    const page = await repairRecordingsPage(supabase, {
      orgId: args.org,
      cursor,
      limit: args.limit,
      apply: args.apply,
      sinceIso,
    });
    console.warn(
      `scanned=${page.scanned} counts=${JSON.stringify(page.counts)} sources=${JSON.stringify(page.sources)} ` +
        `nextCursor=${page.nextCursor ?? '-'}`,
    );
    for (const [k, v] of Object.entries(page.counts)) totals[k] = (totals[k] ?? 0) + v;
    for (const k of Object.keys(totalSources) as RepairSource[]) totalSources[k] += page.sources[k];
    cursor = page.nextCursor;
  } while (cursor);
  console.warn(`TOTAL counts=${JSON.stringify(totals)} sources=${JSON.stringify(totalSources)}`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
