import { vi } from 'vitest';

/**
 * Cliente Supabase de mentira que se comporta como o PostgREST nos pontos que
 * já quebraram as telas de estatística em produção (set/2026):
 *
 * - **Teto do servidor**: cada resposta traz no máximo `serverCap` linhas, sem
 *   avisar — `.limit(10000)` ou um `await` direto em cima de 15 mil linhas
 *   devolve só as primeiras.
 * - **URL longa demais**: `.in()` com mais de `maxInValues` valores devolve
 *   erro 414 (`data: null`) — o código antigo tratava isso como "lista vazia".
 * - `.range(from, to)` devolve a fatia pedida (respeitando o teto).
 * - `.eq()`/`.in()`/`.gte()`/`.lte()`/`.gt()`/`.lt()` filtram de verdade quando
 *   a coluna existe na linha de teste (colunas ausentes, como `org_id`, são
 *   ignoradas; `null` nunca passa numa comparação, como no SQL).
 * - `.order()` ordena de verdade (útil para "mais recentes primeiro").
 * - `.rpc(nome, args)` lê as linhas de `opts.rpc[nome](args)` ou, sem handler,
 *   de `tables['rpc:nome']` (mesmo teto e `.range()`); guarda os argumentos em
 *   `rpcCalls`.
 * - `.neq()`, `.is(col, null)` e `.not(col, 'in' | 'is', …)` também filtram.
 *
 * Os outros filtros (`or`, `like`…) são aceitos e ignorados: os testes montam
 * só linhas que já passariam por eles.
 */
export interface FakeSupabaseOptions {
  serverCap?: number;
  maxInValues?: number;
  /** Linhas devolvidas por um RPC em função dos argumentos. */
  rpc?: Record<string, (args: Record<string, unknown>) => readonly object[]>;
}

type Row = Record<string, unknown>;

const PASS_THROUGH = ['select', 'or', 'filter', 'like', 'ilike'];

/** `'(a,b)'` → `['a', 'b']` (formato do PostgREST para `not.in`). */
const parseList = (v: unknown) =>
  String(v)
    .replace(/^\(|\)$/g, '')
    .split(',')
    .map((x) => x.trim().replace(/^"|"$/g, ''));
const COMPARE: Record<string, (x: string, y: string) => boolean> = {
  gte: (x, y) => x >= y,
  lte: (x, y) => x <= y,
  gt: (x, y) => x > y,
  lt: (x, y) => x < y,
};

export function createFakeSupabase(tables: Record<string, Row[]>, opts: FakeSupabaseOptions = {}) {
  const serverCap = opts.serverCap ?? 1000;
  const maxInValues = opts.maxInValues ?? 300;
  /** Todas as ordenações pedidas, por tabela — para conferir o desempate por coluna única. */
  const orders: Record<string, string[][]> = {};
  const rangeCalls: Record<string, number> = {};
  const rpcCalls: Array<{ name: string; args: unknown }> = [];

  function builder(table: string, rowsOverride?: Row[]) {
    const rows = rowsOverride ?? tables[table] ?? [];
    const filters: Array<(r: Row) => boolean> = [];
    const order: Array<{ col: string; asc: boolean }> = [];
    let limit = Infinity;
    let uriTooLong = false;
    let orderRecorded = false;

    const run = (from = 0, to = Infinity) => {
      if (!orderRecorded) {
        (orders[table] ??= []).push(order.map((o) => o.col));
        orderRecorded = true;
      }
      if (uriTooLong) return { data: null, error: { message: '414 URI Too Long' } };
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (order.length > 0) {
        out = [...out].sort((a, b) => {
          for (const { col, asc } of order) {
            const x = String(a[col] ?? '');
            const y = String(b[col] ?? '');
            if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
          }
          return 0;
        });
      }
      const end = Math.min(to + 1, from + serverCap, from + limit);
      return { data: out.slice(from, end), error: null };
    };

    const b: Record<string, unknown> = {};
    for (const m of PASS_THROUGH) b[m] = vi.fn(() => b);
    b.eq = vi.fn((col: string, value: unknown) => {
      filters.push((r) => !(col in r) || r[col] === value);
      return b;
    });
    b.neq = vi.fn((col: string, value: unknown) => {
      filters.push((r) => !(col in r) || (r[col] != null && r[col] !== value));
      return b;
    });
    b.is = vi.fn((col: string, value: unknown) => {
      filters.push((r) => !(col in r) || (value === null ? r[col] == null : r[col] === value));
      return b;
    });
    b.not = vi.fn((col: string, op: string, value: unknown) => {
      if (op === 'in') {
        const list = new Set(parseList(value));
        filters.push((r) => !(col in r) || (r[col] != null && !list.has(String(r[col]))));
      } else if (op === 'is' && value === null) {
        filters.push((r) => !(col in r) || r[col] != null);
      }
      return b;
    });
    for (const [op, cmp] of Object.entries(COMPARE)) {
      b[op] = vi.fn((col: string, value: unknown) => {
        filters.push((r) => !(col in r) || (r[col] != null && cmp(String(r[col]), String(value))));
        return b;
      });
    }
    b.in = vi.fn((col: string, values: unknown[]) => {
      if (values.length > maxInValues) uriTooLong = true;
      const set = new Set(values);
      filters.push((r) => !(col in r) || set.has(r[col]));
      return b;
    });
    b.order = vi.fn((col: string, o?: { ascending?: boolean }) => {
      order.push({ col, asc: o?.ascending ?? true });
      return b;
    });
    b.limit = vi.fn((n: number) => {
      limit = n;
      return b;
    });
    b.range = vi.fn((from: number, to: number) => {
      rangeCalls[table] = (rangeCalls[table] ?? 0) + 1;
      return Promise.resolve(run(from, to));
    });
    b.maybeSingle = vi.fn(() => Promise.resolve({ data: run().data?.[0] ?? null, error: null }));
    b.single = b.maybeSingle;
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(run()).then(resolve, reject);
    return b;
  }

  const client = {
    from: vi.fn((table: string) => builder(table)),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      const handler = opts.rpc?.[name];
      return builder(`rpc:${name}`, handler ? (handler(args) as Row[]) : undefined);
    }),
  };
  return { client: client as never, orders, rangeCalls, rpcCalls };
}

/** Linhas numeradas `0..n-1` com campos em comum — ids em ordem lexicográfica. */
export function makeRows<T extends Row>(n: number, make: (i: number, id: string) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i, `id-${String(i).padStart(6, '0')}`));
}
