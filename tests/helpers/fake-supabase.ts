// Cliente Supabase falso e gravador de operações (dados fictícios, sem rede).
export type Call = {
  client: string;
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  payload?: unknown;
  selectArgs?: unknown[];
  filters: Array<[string, ...unknown[]]>;
};
export type Responder = (call: Call, terminal?: 'single' | 'maybeSingle') => { data?: unknown; error?: unknown; count?: number | null };

const FILTERS = new Set(['eq', 'neq', 'in', 'is', 'gte', 'lte', 'lt', 'gt', 'not', 'ilike', 'like', 'or', 'contains', 'match']);

export function fakeClient(tag: string, log: Call[], responder: Responder = () => ({ data: null, error: null }), rpcImpl?: (name: string, args: unknown) => unknown) {
  return {
    tag,
    from(table: string) {
      const call: Call = { client: tag, table, op: 'select', filters: [] };
      log.push(call);
      const proxy: unknown = new Proxy({}, {
        get(_t, prop: string) {
          if (prop === 'then') {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              Promise.resolve({ data: null, error: null, count: null, ...responder(call) }).then(res, rej);
          }
          if (prop === 'select') return (...a: unknown[]) => { if (call.op === 'select') call.selectArgs = a; return proxy; };
          if (['insert', 'update', 'delete', 'upsert'].includes(prop)) {
            return (payload?: unknown) => { call.op = prop as Call['op']; call.payload = payload; return proxy; };
          }
          if (FILTERS.has(prop)) return (...a: unknown[]) => { call.filters.push([prop, ...a]); return proxy; };
          if (prop === 'single' || prop === 'maybeSingle') {
            return () => Promise.resolve({ data: null, error: null, ...responder(call, prop) });
          }
          return () => proxy; // order, limit, range...
        },
      });
      return proxy;
    },
    rpc(name: string, args: unknown) {
      log.push({ client: tag, table: `rpc:${name}`, op: 'select', payload: args, filters: [] });
      return Promise.resolve({ data: rpcImpl ? rpcImpl(name, args) : null, error: null });
    },
  };
}

export const hasFilter = (c: Call, col: string, val?: unknown) =>
  c.filters.some(([, k, v]) => k === col && (val === undefined || v === val));
export const writes = (log: Call[], client: string) => log.filter((c) => c.client === client && c.op !== 'select');
