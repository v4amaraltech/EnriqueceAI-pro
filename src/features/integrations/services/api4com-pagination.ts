import type { Api4ComPaginationMeta } from '@/features/integrations/types/api4com';

/**
 * Paginação do GET /calls da API4COM. A API devolve o objeto em `meta`
 * (confirmado em 2026-05-18, ver o reconcile); `metadata` fica só como
 * fallback para respostas no formato antigo da documentação.
 */
export function api4comPagination(json: unknown): Api4ComPaginationMeta | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const body = json as { meta?: unknown; metadata?: unknown };
  const pick = (value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Api4ComPaginationMeta)
      : null;
  return pick(body.meta) ?? pick(body.metadata);
}

/** Próxima página, ou null quando a API diz que acabou (ou não informa). */
export function api4comNextPage(json: unknown): number | null {
  const next = api4comPagination(json)?.nextPage;
  return typeof next === 'number' && Number.isFinite(next) && next > 0 ? next : null;
}
