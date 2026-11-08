/**
 * Banco em memoria para testar o score de prioridade v2 (PR11).
 *
 * Nao ha Postgres neste ambiente. O fake reproduz o que importa para estes testes:
 * filtros eq/in/gte/is, indice unico de decision_events (org_id + idempotency_key)
 * e append-only (update e delete lancam). RLS NAO e simulada: o isolamento por
 * organizacao so passa se o codigo filtrar org_id, que e exatamente o que se testa.
 * Politica real (RLS, trigger) fica para teste de integracao com Postgres.
 */

export type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  /** Log de leituras por tabela, com os filtros eq usados. */
  reads: Array<{ table: string; eq: Record<string, unknown> }>;
  /** Tabelas que devem falhar na leitura. */
  failReads: Set<string>;
  inserts: Array<{ table: string; row: Row }>;
}

export function makeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables: { ...tables }, reads: [], failReads: new Set(), inserts: [] };
}

type Filter = (r: Row) => boolean;

export function makeFakeClient(db: FakeDb) {
  return {
    from(table: string) {
      const filters: Filter[] = [];
      const eq: Record<string, unknown> = {};
      let insertRow: Row | null = null;
      const rows = () => db.tables[table] ?? (db.tables[table] = []);
      const run = () => {
        if (insertRow) {
          const row = insertRow;
          if (table === 'decision_events') {
            const dup = rows().some((r) => r.org_id === row.org_id && r.idempotency_key === row.idempotency_key);
            if (dup) return { data: null, error: { message: 'duplicate key', code: '23505' } };
          }
          rows().push({ id: `${table}-${rows().length + 1}`, created_at: '2026-11-07T12:00:00Z', ...row });
          db.inserts.push({ table, row });
          return { data: null, error: null };
        }
        db.reads.push({ table, eq: { ...eq } });
        if (db.failReads.has(table)) return { data: null, error: { message: 'falha de leitura' } };
        return { data: rows().filter((r) => filters.every((f) => f(r))), error: null, count: null };
      };
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = (col: string, v: unknown) => {
        eq[col] = v;
        filters.push((r) => r[col] === v);
        return b;
      };
      b.in = (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(r[col]));
        return b;
      };
      b.gte = (col: string, v: string) => {
        filters.push((r) => String(r[col]) >= v);
        return b;
      };
      b.is = (col: string, v: unknown) => {
        filters.push((r) => (v === null ? r[col] == null : r[col] === v));
        return b;
      };
      // Sem efeito no fake: o teste ja entrega as linhas relevantes.
      for (const m of ['not', 'or', 'order', 'range']) b[m] = () => b;
      b.limit = () => b;
      b.maybeSingle = async () => {
        const r = run() as { data: Row[] | null; error: unknown };
        return { data: r.data?.[0] ?? null, error: r.error };
      };
      b.insert = (row: Row) => {
        insertRow = row;
        return b;
      };
      b.update = () => {
        throw new Error('decision_events e append-only: update proibido');
      };
      b.upsert = () => {
        throw new Error('upsert proibido');
      };
      b.delete = () => {
        throw new Error('decision_events e append-only: delete proibido');
      };
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  };
}
