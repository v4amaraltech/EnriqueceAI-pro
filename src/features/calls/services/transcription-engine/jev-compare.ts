/**
 * Comparação Typesafe x OpenRouter do JEV (usada por scripts/compare-jev-providers.ts).
 * Só lê o banco. Nunca imprime nem grava transcrição, resumo, nomes ou telefones: só ids
 * curtos e rótulos. Imports relativos de propósito: o script roda fora do Next.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { ENGINE_PROVIDER_QUALIFICATION, ENGINE_PROVIDER_TRANSCRIPT } from './constants';
import {
  type JevInput,
  type JevProviderName,
  type JevQualification,
  createJevClient,
  resolveJevProvider,
  toJevInput,
} from './jev.client';

export const COMPARE_ORG_ID = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
export const COMPARE_DEFAULT_LIMIT = 15;
export const COMPARE_MAX_LIMIT = 30;

export interface CompareArgs {
  send: boolean;
  limit: number;
  envFile: string;
}

export function parseCompareArgs(argv: string[]): CompareArgs {
  const args: CompareArgs = { send: false, limit: COMPARE_DEFAULT_LIMIT, envFile: '.env.local' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--send') {
      args.send = true;
    } else if (flag === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 1 || n > COMPARE_MAX_LIMIT) {
        throw new Error(`--limit precisa ser um inteiro de 1 a ${COMPARE_MAX_LIMIT}.`);
      }
      args.limit = n;
    } else if (flag === '--env-file') {
      const path = argv[++i];
      if (!path) throw new Error('--env-file precisa de um caminho.');
      args.envFile = path;
    } else {
      throw new Error('Argumento desconhecido. Use --send, --limit N, --env-file caminho.');
    }
  }
  return args;
}

/** Nomes (nunca valores) das envs que faltam. As chaves do JEV só importam com --send. */
export function missingCompareEnv(env: NodeJS.ProcessEnv, send: boolean): string[] {
  const missing = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !env[k]);
  if (!send) return missing;
  if (!resolveJevProvider(env, 'typesafe')) missing.push('JEV_API_KEY (ou TYPESAFE_API_KEY)');
  if (!resolveJevProvider(env, 'openrouter')) missing.push('OPENROUTER_API_KEY');
  return missing;
}

export interface CompareSample {
  callId: string;
  input: JevInput;
}

interface QualificationRef {
  call_id: string;
}
interface TranscriptRow {
  call_id: string;
  text: string | null;
  utterances: unknown;
  speakers_count: number | null;
  error: string | null;
}
interface CallInfo {
  id: string;
  duration_seconds: number | null;
  type: string | null;
}

function rowsOf<T>(table: string, res: { data: unknown; error: unknown }): T[] {
  if (res.error) {
    const code = (res.error as { code?: unknown }).code;
    throw new Error(
      `Leitura falhou em ${table}${typeof code === 'string' && code ? ` (${code})` : ''}.`,
    );
  }
  return (res.data ?? []) as T[];
}

/** As ligações mais recentes com transcrição e análise JEV concluídas. SOMENTE LEITURA. */
export async function loadCompareSamples(
  db: SupabaseClient,
  orgId: string,
  limit: number,
): Promise<CompareSample[]> {
  const quals = rowsOf<QualificationRef>(
    'call_qualifications',
    await db
      .from('call_qualifications')
      .select('call_id')
      .eq('org_id', orgId)
      .eq('provider', ENGINE_PROVIDER_QUALIFICATION)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(limit * 2),
  );
  const ids = quals.map((q) => q.call_id);
  if (ids.length === 0) return [];
  const transcripts = rowsOf<TranscriptRow>(
    'call_transcripts_v2',
    await db
      .from('call_transcripts_v2')
      .select('call_id, text, utterances, speakers_count, error')
      .eq('org_id', orgId)
      .eq('provider', ENGINE_PROVIDER_TRANSCRIPT)
      .eq('status', 'completed')
      .in('call_id', ids),
  );
  const calls = rowsOf<CallInfo>(
    'calls',
    await db.from('calls').select('id, duration_seconds, type').eq('org_id', orgId).in('id', ids),
  );
  const transcriptByCall = new Map(transcripts.map((t) => [t.call_id, t]));
  const callById = new Map(calls.map((c) => [c.id, c]));
  const samples: CompareSample[] = [];
  for (const id of ids) {
    if (samples.length >= limit) break;
    const t = transcriptByCall.get(id);
    const call = callById.get(id);
    if (!t?.text?.trim() || !call) continue;
    samples.push({
      callId: id,
      input: toJevInput(call, {
        text: t.text,
        utterances: t.utterances,
        error: t.error,
        speakersCount: t.speakers_count,
      }),
    });
  }
  return samples;
}

type RunName = 'typesafe_1' | 'typesafe_2' | 'openrouter';

const RUNS: ReadonlyArray<{ run: RunName; provider: JevProviderName; label: string }> = [
  { run: 'typesafe_1', provider: 'typesafe', label: 'Typesafe #1' },
  { run: 'typesafe_2', provider: 'typesafe', label: 'Typesafe #2' },
  { run: 'openrouter', provider: 'openrouter', label: 'OpenRouter' },
];

type RunResult =
  | { ok: true; q: JevQualification; latencyMs: number }
  | { ok: false; error: string; latencyMs: number };

const FIELDS: ReadonlyArray<{ name: string; get: (q: JevQualification) => string }> = [
  { name: 'outcome', get: (q) => q.outcome },
  { name: 'interest', get: (q) => q.interest },
  { name: 'has_objections', get: (q) => String(q.objections.has_objections) },
  { name: 'objection_type', get: (q) => q.objections.main_type },
  { name: 'next_step', get: (q) => q.nextStepSuggestion },
  { name: 'needsReview', get: (q) => String(q.needsReview) },
];

/** Só rótulos curtos vão para a tela: texto solto devolvido pelo provedor vira "?". */
function safeLabel(value: string): string {
  return /^[\w~./:-]{1,60}$/.test(value) ? value : '?';
}

/** Código do erro, sem mensagem livre (que poderia trazer trecho da resposta). */
function errorCode(err: unknown): string {
  if (!(err instanceof Error)) return 'unknown_error';
  return err.message.startsWith('jev_') ? safeLabel(err.message) : safeLabel(err.name);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function countBy(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts.size ? [...counts].map(([k, n]) => `${k} (${n})`).join(', ') : 'nenhum';
}

type Row = Partial<Record<RunName, RunResult>>;

function report(rows: Row[], log: (line: string) => void): void {
  // As duas colunas usam o mesmo conjunto: só ligações com as três respostas.
  const full = rows.flatMap((r) => {
    const a = r.typesafe_1;
    const b = r.typesafe_2;
    const o = r.openrouter;
    return a?.ok && b?.ok && o?.ok ? [{ a: a.q, b: b.q, o: o.q }] : [];
  });
  log('');
  log(`Comparáveis (3 respostas): ${full.length} de ${rows.length}`);
  if (full.length) {
    const rate = (hits: number) =>
      `${hits}/${full.length} (${Math.round((hits / full.length) * 100)}%)`;
    log(`${'Concordância'.padEnd(28)}${'Typesafe x Typesafe'.padEnd(24)}OpenRouter x Typesafe`);
    for (const f of FIELDS) {
      const base = full.filter((x) => f.get(x.a) === f.get(x.b)).length;
      const or = full.filter((x) => f.get(x.a) === f.get(x.o)).length;
      log(`${f.name.padEnd(28)}${rate(base).padEnd(24)}${rate(or)}`);
    }
    const base = mean(full.map((x) => Math.abs(x.a.confidence - x.b.confidence)));
    const or = mean(full.map((x) => Math.abs(x.a.confidence - x.o.confidence)));
    log(`${'dif. média de confiança'.padEnd(28)}${base.toFixed(3).padEnd(24)}${or.toFixed(3)}`);
  }
  log('');
  for (const { run, label } of RUNS) {
    const results = rows.flatMap((r) => (r[run] ? [r[run] as RunResult] : []));
    const ok = results.flatMap((r) => (r.ok ? [r] : []));
    const tokens = ok.map((r) => r.q.inputTokens);
    const latency = ok.map((r) => r.latencyMs);
    log(`${label}: ${ok.length}/${results.length} ok`);
    log(`  modelo: ${countBy(ok.map((r) => safeLabel(r.q.model)))}`);
    log(
      `  tokens de entrada: total ${tokens.reduce((a, b) => a + b, 0)}, média ${Math.round(mean(tokens))}`,
    );
    log(
      `  latência (ms): média ${Math.round(mean(latency))}, mediana ${Math.round(median(latency))}, máx ${Math.round(Math.max(0, ...latency))}`,
    );
    log(`  erros: ${countBy(results.flatMap((r) => (r.ok ? [] : [r.error])))}`);
  }
}

export interface CompareDeps {
  args: CompareArgs;
  env: NodeJS.ProcessEnv;
  samples: CompareSample[];
  log: (line: string) => void;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Sem --send: só lista. Com --send: Typesafe, Typesafe de novo e OpenRouter, uma por vez. */
export async function runJevCompare(deps: CompareDeps): Promise<{ exitCode: number }> {
  const { args, env, samples, log } = deps;
  const now = deps.now ?? (() => Date.now());
  const shortId = (id: string) => id.slice(0, 8);
  log(`${samples.length} ligações com transcrição e análise JEV.`);
  if (samples.length === 0) return { exitCode: 0 };
  if (!args.send) {
    log(samples.map((s) => shortId(s.callId)).join(' '));
    log('Dry-run: nada foi enviado. Use --send para comparar.');
    return { exitCode: 0 };
  }

  const clients = RUNS.map((r) => {
    const provider = resolveJevProvider(env, r.provider);
    if (!provider) throw new Error(`Falta a chave do provedor ${r.provider}.`);
    return { ...r, client: createJevClient({ provider, fetchImpl: deps.fetchImpl }) };
  });

  log('Campos por ligação: outcome/interest/has_objections/objection_type/next_step/needsReview');
  const rows: Row[] = [];
  let stopped: string | null = null;
  for (const sample of samples) {
    const row: Row = {};
    rows.push(row);
    const parts: string[] = [shortId(sample.callId)];
    for (const { run, label, client } of clients) {
      const started = now();
      try {
        const q = await client.qualify(sample.input);
        row[run] = { ok: true, q, latencyMs: now() - started };
        parts.push(`${label}: ${FIELDS.map((f) => safeLabel(f.get(q))).join('/')}`);
      } catch (err) {
        const error = errorCode(err);
        row[run] = { ok: false, error, latencyMs: now() - started };
        parts.push(`${label}: ERRO ${error}`);
        const status = /^jev_http_(401|402)$/.exec(error)?.[1];
        if (status) {
          const why = status === '401' ? 'chave recusada' : 'sem crédito';
          stopped = `Parado: ${label} devolveu HTTP ${status} (${why}).`;
          break;
        }
      }
    }
    log(parts.join(' | '));
    if (stopped) break;
  }
  report(rows, log);
  if (stopped) log(stopped);
  return { exitCode: stopped ? 1 : 0 };
}
