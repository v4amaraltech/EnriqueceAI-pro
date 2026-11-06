import { cache } from 'react';

import type { SupabaseClient } from '@supabase/supabase-js';

import { brtNowParts } from '../utils/brt-now';

/**
 * Leads abertos (1º toque humano + reaberturas) — fonte única do Dashboard.
 *
 * `count_leads_opened_by_sdr` e `count_leads_opened_by_sdr_daily` calculam o
 * MESMO conjunto de aberturas sobre `leads_opened_events` (história inteira da
 * org, ~230 ms por chamada com cache quente, picos de segundos sob carga); a 1ª
 * só agrupa por SDR. O Dashboard chamava as duas em série no card "Leads
 * Abertos" e mais uma vez no painel "SDR selecionado" — 3 recálculos por
 * abertura de tela. Aqui uma chamada à versão por linha serve todos: o total
 * por SDR sai das próprias linhas.
 */

export interface LeadsOpenedRow {
  performer_id: string;
  opened_at: string;
}

export type LeadsOpenedResult = { data: LeadsOpenedRow[]; error: null } | { data: null; error: { message: string } };

// Memo por requisição (React `cache`): o card do ranking e o painel do SDR
// renderizam na mesma requisição do Dashboard e dividem uma única chamada quando
// pedem a mesma janela. Fora de render, `cache` não memoriza e cada chamada vai
// ao banco (comportamento antigo).
const requestMemo = cache(() => new Map<string, Promise<LeadsOpenedResult>>());

/** PostgREST deste projeto corta em 20.000 linhas (sem erro). */
const POSTGREST_MAX_ROWS = 20_000;

/**
 * Fim de janela depois de hoje vira "hoje 23:59:59 BRT". Não existe abertura no
 * futuro, então o resultado é o mesmo — e a página do Dashboard já corta o mês
 * corrente em hoje enquanto o painel do SDR pede o mês inteiro: sem isto as duas
 * janelas nunca coincidiam no mês corrente (a tela padrão) e eram 2 chamadas.
 */
export function clampEndToToday(end: string, now: { year: number; month1: number; day: number } = brtNowParts()): string {
  const todayEnd = `${now.year}-${String(now.month1).padStart(2, '0')}-${String(now.day).padStart(2, '0')}T23:59:59-03:00`;
  return new Date(end).getTime() > new Date(todayEnd).getTime() ? todayEnd : end;
}

export function fetchLeadsOpenedRows(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  cadenceIds: string[] | null,
): Promise<LeadsOpenedResult> {
  const cadences = cadenceIds && cadenceIds.length > 0 ? [...cadenceIds].sort() : null;
  const windowEnd = clampEndToToday(end);
  const key = [orgId, start, windowEnd, cadences?.join(',') ?? ''].join('|');
  const memo = requestMemo();
  const hit = memo.get(key);
  if (hit) return hit;

  const promise = (async (): Promise<LeadsOpenedResult> => {
    const { data, error } = (await (supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: LeadsOpenedRow[] | null; error: { message: string } | null }>)(
      'count_leads_opened_by_sdr_daily',
      { p_org_id: orgId, p_start: start, p_end: windowEnd, p_cadence_ids: cadences },
    ));
    if (error) return { data: null, error };
    if ((data?.length ?? 0) >= POSTGREST_MAX_ROWS) {
      // Corte silencioso do PostgREST: total e gráfico sairiam menores.
      console.warn(`[leads-opened] ${data?.length} linhas — no limite do PostgREST; números podem estar cortados (org=${orgId})`);
    }
    return { data: data ?? [], error: null };
  })();
  memo.set(key, promise);
  return promise;
}

/** Aberturas por SDR (o que `count_leads_opened_by_sdr` devolvia). */
export function countOpenedByPerformer(rows: ReadonlyArray<LeadsOpenedRow>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.performer_id, (counts.get(r.performer_id) ?? 0) + 1);
  return counts;
}
