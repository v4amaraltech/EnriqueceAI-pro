import { vi } from 'vitest';

/**
 * Supabase falso para os testes da fila: cada consulta registra a tabela, a
 * operação (select/update/insert/upsert), o payload e os filtros, e resolve com o
 * que o `handler` devolver. Assim o teste afirma o que foi escrito no banco.
 */
export interface RecordedQuery {
  table: string;
  op: 'select' | 'update' | 'insert' | 'upsert' | 'delete';
  payload?: unknown;
  filters: Array<[string, ...unknown[]]>;
  single: boolean;
}

export type Handler = (q: RecordedQuery) => { data?: unknown; error?: unknown; count?: number | null } | undefined;

export function createFakeSupabase(handler: Handler) {
  const queries: RecordedQuery[] = [];

  const from = vi.fn((table: string) => {
    const q: RecordedQuery = { table, op: 'select', filters: [], single: false };
    let opSet = false;
    const builder: Record<string, unknown> = {};
    const setOp = (op: RecordedQuery['op'], payload?: unknown) => {
      if (!opSet || op !== 'select') {
        q.op = op;
        if (payload !== undefined) q.payload = payload;
      }
      opSet = true;
      return builder;
    };
    builder.select = vi.fn(() => (opSet ? builder : setOp('select')));
    builder.update = vi.fn((p: unknown) => setOp('update', p));
    builder.insert = vi.fn((p: unknown) => setOp('insert', p));
    builder.upsert = vi.fn((p: unknown) => setOp('upsert', p));
    builder.delete = vi.fn(() => setOp('delete'));
    for (const m of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is', 'in', 'not', 'or', 'order', 'limit']) {
      builder[m] = vi.fn((...args: unknown[]) => {
        q.filters.push([m, ...args]);
        return builder;
      });
    }
    const resolve = () => {
      queries.push(q);
      const r = handler(q) ?? {};
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null, count: r.count ?? null });
    };
    builder.single = vi.fn(() => {
      q.single = true;
      return resolve();
    });
    builder.maybeSingle = vi.fn(() => {
      q.single = true;
      return resolve();
    });
    builder.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => resolve().then(ok, ko);
    return builder;
  });

  const rpc = vi.fn(() => Promise.resolve({ data: [{ advanced: true, completed: false, new_step: 2 }], error: null }));

  return { client: { from, rpc } as never, queries, from, rpc };
}

/** Valor de um filtro `eq` registrado (ou undefined). */
export function eqValue(q: RecordedQuery, column: string): unknown {
  return q.filters.find((f) => f[0] === 'eq' && f[1] === column)?.[2];
}
