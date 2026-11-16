/**
 * Banco em memória para os testes do motor automático. Só leitura/contagem + `rpc` configurável; qualquer
 * escrita (`insert`/`update`/`delete`) é REGISTRADA em `writes` para os testes provarem que o modo simulado e as
 * recusas não escrevem em `calls`. Não simula RLS: o isolamento por org só passa se o código filtrar `org_id`.
 */
import type { Mock } from 'vitest';

export type Row = Record<string, unknown>;

export interface AutoDialDb {
  tables: Record<string, Row[]>;
  /** Tabelas cuja leitura deve falhar. */
  failReads: Set<string>;
  /** Filtros `eq` usados em cada leitura (prova de `org_id` em toda consulta). */
  reads: Array<{ table: string; eq: Record<string, unknown> }>;
  writes: Array<{ table: string; op: string }>;
  rpc: Mock<(...args: unknown[]) => Promise<unknown>>;
}

type Result = { data: Row[] | Row | null; error: { message: string } | null; count?: number | null };

export function makeAutoDialClient(db: AutoDialDb) {
  return {
    rpc: (...args: unknown[]) => db.rpc(...args),
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const eq: Record<string, unknown> = {};
      let head = false;
      let wantCount = false;
      const pick = (r: Row, col: string): unknown => {
        const [base, key] = col.split('->');
        const v = r[base!];
        return key && v && typeof v === 'object' ? (v as Row)[key] : v;
      };
      const run = (): Result => {
        db.reads.push({ table, eq: { ...eq } });
        if (db.failReads.has(table)) return { data: null, error: { message: `falha de leitura em ${table}` }, count: null };
        const rows = (db.tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return { data: head ? null : rows, error: null, count: wantCount ? rows.length : null };
      };
      const b: Record<string, unknown> = {};
      b.select = (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        wantCount = Boolean(opts?.count);
        head = Boolean(opts?.head);
        return b;
      };
      b.eq = (col: string, v: unknown) => {
        eq[col] = v;
        filters.push((r) => pick(r, col) === v);
        return b;
      };
      b.in = (col: string, vs: unknown[]) => {
        filters.push((r) => vs.includes(pick(r, col)));
        return b;
      };
      b.lte = (col: string, v: string) => {
        filters.push((r) => String(pick(r, col) ?? '') <= v);
        return b;
      };
      b.neq = (col: string, v: unknown) => {
        filters.push((r) => pick(r, col) !== v);
        return b;
      };
      b.gte = (col: string, v: string) => {
        filters.push((r) => String(pick(r, col) ?? '') >= v);
        return b;
      };
      b.is = (col: string, v: unknown) => {
        filters.push((r) => (v === null ? pick(r, col) == null : pick(r, col) === v));
        return b;
      };
      b.not = (col: string, op: string, v: unknown) => {
        if (op !== 'is') throw new Error(`not(${op}) não suportado no fake`);
        filters.push((r) => (v === null ? pick(r, col) != null : pick(r, col) !== v));
        return b;
      };
      b.limit = () => b;
      b.order = () => b;
      b.maybeSingle = async () => {
        const r = run();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : null, error: r.error };
      };
      for (const op of ['insert', 'update', 'upsert', 'delete']) {
        b[op] = () => {
          db.writes.push({ table, op });
          return b;
        };
      }
      b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
      return b;
    },
  };
}
