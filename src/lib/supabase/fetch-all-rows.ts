/**
 * Lê TODAS as linhas de uma consulta, em páginas.
 *
 * Por que existe (10/set/2026): as telas de estatística faziam `.limit(10000)`
 * e o PostgREST corta no teto do servidor sem avisar — a tela de Ligações da
 * V4 Amaral (10–11 mil ligações/mês) mostrava números de um subconjunto
 * ARBITRÁRIO das ligações em qualquer período de 30 dias ou mais.
 *
 * Como funciona: pede `[offset, offset + pageSize - 1]` e avança `offset` pelo
 * número de linhas que REALMENTE chegou, até vir uma página vazia. Assim é
 * correto qualquer que seja o teto do servidor (1.000, 10.000…), mesmo menor
 * que `pageSize`.
 *
 * `buildQuery` precisa devolver uma consulta NOVA a cada chamada (os builders
 * do supabase-js são de uso único) e com ORDEM DETERMINÍSTICA terminando numa
 * coluna única (ex.: `.order('started_at').order('id')`) — senão a paginação
 * pode repetir ou pular linhas.
 */

export const FETCH_ALL_DEFAULT_PAGE_SIZE = 5000;
export const FETCH_ALL_DEFAULT_MAX_ROWS = 200_000;

export interface RangeableQuery<T> {
  range(from: number, to: number): PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
}

export interface FetchAllRowsResult<T> {
  rows: T[];
  /** Parou em `maxRows` com mais linhas por ler. */
  truncated: boolean;
}

export async function fetchAllRows<T>(
  buildQuery: () => RangeableQuery<T>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllRowsResult<T>> {
  const pageSize = opts.pageSize ?? FETCH_ALL_DEFAULT_PAGE_SIZE;
  const maxRows = opts.maxRows ?? FETCH_ALL_DEFAULT_MAX_ROWS;
  const rows: T[] = [];

  while (rows.length < maxRows) {
    const from = rows.length;
    const to = Math.min(from + pageSize, maxRows) - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw new Error(`fetchAllRows: ${error.message}`);
    const page = data ?? [];
    if (page.length === 0) return { rows, truncated: false };
    rows.push(...page);
  }

  // Bateu no teto: confere se ainda havia linhas.
  const { data: extra, error } = await buildQuery().range(maxRows, maxRows);
  if (error) throw new Error(`fetchAllRows: ${error.message}`);
  return { rows, truncated: (extra ?? []).length > 0 };
}
