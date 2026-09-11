import { type RangeableQuery, fetchAllRows } from '@/lib/supabase/fetch-all-rows';

/**
 * `fetchAllRows` para as telas de estatística: devolve só as linhas e deixa
 * rastro no log se bater no teto de segurança (200 mil). Antes (set/2026) estas
 * consultas usavam `.limit(10000)` e cortavam em silêncio — ver story
 * `statistics-fetch-all-rows`.
 *
 * `buildQuery` precisa de ordem determinística terminando em coluna única.
 * `T` é o formato da linha — mesmo papel do `as { data: T[] }` que estas
 * consultas já usavam (o builder de `from()` é tipado de forma solta).
 */
export async function readAllRows<T>(
  label: string,
  buildQuery: () => RangeableQuery<unknown>,
  opts?: { pageSize?: number },
): Promise<T[]> {
  const { rows, truncated } = await fetchAllRows<unknown>(buildQuery, opts);
  if (truncated) {
    console.warn(
      `[statistics] ${label}: parou em ${rows.length} linhas (teto de segurança) — número parcial`,
    );
  }
  return rows as T[];
}
