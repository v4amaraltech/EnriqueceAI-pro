import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { applyMetadataPatch } from '@/features/calls/services/merge-calls-metadata';
import { persistCallRecording } from '@/features/calls/services/recording-storage.service';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { POST } from './route';

vi.mock('@/lib/auth/verify-service-role', () => ({ verifyServiceRole: () => true }));
vi.mock('@/lib/auth/verify-cron-secret', () => ({ verifyCronSecret: () => false }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/features/calls/services/recording-storage.service', () => ({
  persistCallRecording: vi.fn(),
}));

const NOW = new Date('2026-11-28T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

interface Row {
  id: string;
  org_id: string;
  created_at: string;
  recording_url: string | null;
  recording_storage_path: string | null;
  duration_seconds: number;
  metadata: Record<string, unknown> | null;
}

const db = createClient('http://db.example', 'test-key', {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (input, init) => fakeFetch(input, init) },
});

let rows: Row[] = [];
let urls: URL[] = [];

function call(id: string, ageHours: number, metadata: Row['metadata'] = {}): Row {
  return {
    id,
    org_id: 'org-1',
    created_at: new Date(NOW.getTime() - ageHours * HOUR).toISOString(),
    recording_url: 'https://api4com.example/rec',
    recording_storage_path: null,
    duration_seconds: 40,
    metadata,
  };
}

const MISMATCH_OR =
  '(metadata->>recording_persist_status.is.null,metadata->>recording_persist_status.neq.mismatch)';

function valueOf(row: Row, column: string): unknown {
  const [base, key] = column.split('->>');
  const raw = (row as unknown as Record<string, unknown>)[base ?? ''];
  if (key === undefined) return raw ?? null;
  const value = (raw as Record<string, unknown> | null)?.[key];
  return value === undefined || value === null ? null : String(value);
}

/**
 * PostgREST em memória: lê a URL que o supabase-js REALMENTE monta. Cada parâmetro é um filtro e
 * todos valem juntos (AND). Filtro desconhecido derruba o teste.
 */
async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

  if (url.pathname.endsWith('/rpc/merge_calls_metadata')) {
    const args = JSON.parse(String(init?.body)) as {
      p_id: string;
      p_patch: Record<string, unknown>;
      p_org_id?: string;
    };
    const row = rows.find((r) => r.id === args.p_id && r.org_id === args.p_org_id);
    if (row) row.metadata = applyMetadataPatch(row.metadata, args.p_patch);
    return json(Boolean(row));
  }

  urls.push(url);
  let result = [...rows];
  let ascending = true;
  let limit = Infinity;
  for (const [column, expr] of url.searchParams) {
    if (column === 'select') continue;
    if (column === 'order') ascending = expr === 'created_at.asc';
    else if (column === 'limit') limit = Number(expr);
    else if (column === 'or') {
      if (expr !== MISMATCH_OR) throw new Error(`or() não modelado: ${expr}`);
      result = result.filter(
        (r) => valueOf(r, 'metadata->>recording_persist_status') !== 'mismatch',
      );
    } else {
      const op = expr.slice(0, expr.indexOf('.'));
      const arg = expr.slice(expr.indexOf('.') + 1);
      result = result.filter((r) => {
        const v = valueOf(r, column);
        if (expr === 'is.null') return v === null;
        if (expr === 'not.is.null') return v !== null;
        if (v === null) return false;
        if (op === 'gt') return Number(v) > Number(arg);
        if (op === 'gte') return String(v) >= arg;
        if (op === 'lte') return String(v) <= arg;
        throw new Error(`filtro não modelado: ${column}=${expr}`);
      });
    }
  }
  result.sort((a, b) => (ascending ? 1 : -1) * a.created_at.localeCompare(b.created_at));
  return json(
    result.slice(0, limit).map((r) => ({
      id: r.id,
      org_id: r.org_id,
      created_at: r.created_at,
      persist_attempts: valueOf(r, 'metadata->>recording_persist_attempts'),
    })),
  );
}

const run = async () =>
  (await POST(new Request('http://localhost/api/cron', { method: 'POST' }))).json();
const tried = () => vi.mocked(persistCallRecording).mock.calls.map((c) => c[1]);
const meta = (id: string) => rows.find((r) => r.id === id)?.metadata;
const waiting = (hoursFromNow: number, attempts = 1) => ({
  recording_persist_attempts: attempts,
  recording_persist_retry_at: new Date(NOW.getTime() + hoursFromNow * HOUR).toISOString(),
});

describe('persist-pending-recordings: espera antes de repetir', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    rows = [];
    urls = [];
    vi.mocked(persistCallRecording)
      .mockReset()
      .mockResolvedValue({ ok: false, reason: 'no_audio_available' });
    vi.mocked(createServiceRoleClient).mockReturnValue(db as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('falha anota a tentativa e a data, sem apagar o resto nem marcar como perdida', async () => {
    rows = [call('a', 2, { ai_outcome: { status: 'pending' } })];
    await expect(run()).resolves.toMatchObject({ total: 1, noAudio: 1 });
    expect(meta('a')).toEqual({ ai_outcome: { status: 'pending' }, ...waiting(1) });
  });

  it.each([
    [0, 1],
    [1, 6],
    [2, 24],
    [3, 7 * 24],
    [9, 7 * 24],
  ])('com %i falhas antes, espera %i h', async (before, hours) => {
    rows = [call('a', 2, before ? waiting(-1, before) : {})];
    await run();
    expect(meta('a')).toEqual(waiting(hours, before + 1));
  });

  it('ignora quem ainda espera; sem a chave, metadata nulo e espera vencida continuam na fila', async () => {
    rows = [
      call('espera', 1, waiting(0.5)),
      call('sem-chave', 2),
      call('nulo', 3, null),
      call('chave-nula', 4, { recording_persist_retry_at: null }),
      call('venceu', 5, waiting(-0.5)),
      call('vence-agora', 6, waiting(0)),
      call('mismatch', 7, { recording_persist_status: 'mismatch' }),
      call('mismatch-venceu', 8, { recording_persist_status: 'mismatch', ...waiting(-1) }),
      call('unverified-espera', 9, { recording_persist_status: 'unverified', ...waiting(1) }),
    ];
    await run();
    expect(tried().sort()).toEqual(['chave-nula', 'nulo', 'sem-chave', 'vence-agora', 'venceu']);
  });

  it('o filtro de mismatch e o de espera vão juntos nas 4 consultas', async () => {
    rows = [call('a', 2)];
    await run();
    expect(urls).toHaveLength(4);
    for (const url of urls) {
      expect(url.searchParams.getAll('or')).toEqual([MISMATCH_OR]);
    }
    const waitFilters = urls.map(
      (u) =>
        `${u.searchParams.get('order')} ${u.searchParams.get('metadata->>recording_persist_retry_at')}`,
    );
    expect(waitFilters.sort()).toEqual([
      'created_at.asc is.null',
      `created_at.asc lte.${NOW.toISOString()}`,
      'created_at.desc is.null',
      `created_at.desc lte.${NOW.toISOString()}`,
    ]);
  });

  it('quem espera abre vaga para as próximas, nas novas e nas antigas', async () => {
    // 60 na fila (c0 = mais nova); 5 de cada ponta esperando; no meio, vencidas e nunca tentadas alternadas.
    rows = Array.from({ length: 60 }, (_, i) => {
      if (i < 5 || i >= 55) return call(`c${i}`, i + 1, waiting(1));
      return call(`c${i}`, i + 1, i % 2 ? waiting(-1) : {});
    });
    await run();
    // 25 mais novas livres (c5..c29) + 25 mais antigas livres (c30..c54).
    expect(tried().sort()).toEqual(Array.from({ length: 50 }, (_, i) => `c${i + 5}`).sort());
  });

  it('na rodada seguinte quem falhou não é repetido', async () => {
    rows = [call('a', 2)];
    await run();
    await expect(run()).resolves.toMatchObject({ processed: 0 });
    expect(tried()).toEqual(['a']);
  });

  it('sucesso não anota', async () => {
    vi.mocked(persistCallRecording).mockResolvedValue({ ok: true });
    rows = [call('a', 2)];
    await expect(run()).resolves.toMatchObject({ persisted: 1 });
    expect(meta('a')).toEqual({});
  });

  it('mismatch não anota (quem trata é o reparo)', async () => {
    vi.mocked(persistCallRecording).mockResolvedValue({
      ok: false,
      reason: 'duration_mismatch',
      status: 'mismatch',
    });
    rows = [call('a', 2)];
    await run();
    expect(meta('a')).toEqual({});
  });

  it('falha no upload anota', async () => {
    vi.mocked(persistCallRecording).mockResolvedValue({ ok: false, reason: 'upload_failed: x' });
    rows = [call('a', 2)];
    await run();
    expect(meta('a')).toEqual(waiting(1));
  });

  it('exceção anota e as outras ligações seguem', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(persistCallRecording)
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true });
    rows = [call('a', 1), call('b', 2)];
    await expect(run()).resolves.toMatchObject({ failed: 1, persisted: 1 });
    expect(meta('a')).toEqual(waiting(1));
    expect(meta('b')).toEqual({});
  });
});
