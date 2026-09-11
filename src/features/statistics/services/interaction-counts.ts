import type { SupabaseClient } from '@supabase/supabase-js';

import { readAllRows } from './read-all-rows';

/**
 * Contagens de interações já agrupadas no banco (RPC `get_interaction_counts`,
 * migration `20260911095436`). Usado por Estatísticas › Atividades e ›
 * Performance, que antes baixavam todas as interações do período (~35 mil em
 * 90 dias na V4 Amaral) só para contar. Story activity-performance-analytics-rpc.
 */

/** 1 grupo (autor, canal, tipo, dia de Brasília) com `n` interações. */
export interface InteractionCell {
  /** `null` = sem autor (automação). */
  performed_by: string | null;
  channel: string;
  type: string;
  /** `YYYY-MM-DD` no fuso de Brasília (`created_at − 3h`). */
  day_brt: string;
  n: number;
  first_at: string;
  last_at: string;
}

export interface PerformerSummary {
  distinctLeads: number;
  lastAt: string;
}

export interface InteractionCounts {
  /**
   * Em ordem da primeira atividade de cada grupo — reproduz a ordem de
   * desempate que as telas tinham quando liam as interações por `created_at`.
   */
  cells: InteractionCell[];
  /** Chave: `performed_by` (inclui `null` = sem autor). */
  performers: Map<string | null, PerformerSummary>;
}

interface CountRow {
  row_kind: 'cell' | 'performer';
  performed_by: string | null;
  channel: string | null;
  type: string | null;
  day_brt: string | null;
  n: number | null;
  distinct_leads: number | null;
  first_at: string;
  last_at: string;
}

/** O RPC roda inteiro a cada página: página do tamanho do teto do servidor (20 mil). */
const PAGE_SIZE = 20_000;

export async function fetchInteractionCounts(
  supabase: SupabaseClient,
  opts: {
    periodStart: string;
    periodEnd: string;
    excludeChannels: string[];
    userIds?: string[];
    cadenceId?: string;
  },
): Promise<InteractionCounts> {
  const rows = await readAllRows<CountRow>(
    'contagens de interações',
    () =>
      supabase
        .rpc('get_interaction_counts', {
          p_start: opts.periodStart,
          p_end: opts.periodEnd,
          p_exclude_channels: opts.excludeChannels,
          // Filtro ausente = parâmetro omitido (DEFAULT NULL na função).
          ...(opts.userIds && opts.userIds.length > 0 ? { p_user_ids: opts.userIds } : {}),
          ...(opts.cadenceId ? { p_cadence_id: opts.cadenceId } : {}),
        })
        // Chave única de cada linha → páginas sem repetir nem pular.
        .order('row_kind', { ascending: true })
        .order('performed_by', { ascending: true, nullsFirst: true })
        .order('channel', { ascending: true })
        .order('type', { ascending: true })
        .order('day_brt', { ascending: true }),
    { pageSize: PAGE_SIZE },
  );

  const cells: InteractionCell[] = [];
  const performers = new Map<string | null, PerformerSummary>();
  for (const r of rows) {
    if (r.row_kind === 'performer') {
      performers.set(r.performed_by, { distinctLeads: r.distinct_leads ?? 0, lastAt: r.last_at });
    } else {
      cells.push({
        performed_by: r.performed_by,
        channel: r.channel ?? '',
        type: r.type ?? '',
        day_brt: r.day_brt ?? '',
        n: r.n ?? 0,
        first_at: r.first_at,
        last_at: r.last_at,
      });
    }
  }
  cells.sort((a, b) => atMicros(a.first_at) - atMicros(b.first_at));
  return { cells, performers };
}

/**
 * Instante em microssegundos (o Postgres guarda µs; `Date.parse` só lê ms) —
 * para ordenar grupos pela 1ª atividade com a mesma precisão do banco.
 */
export function atMicros(iso: string): number {
  const frac = /\.(\d+)/.exec(iso)?.[1] ?? '';
  const micros = Number(frac.padEnd(6, '0').slice(3, 6));
  return Date.parse(iso) * 1000 + micros;
}

/** Soma `n` das células que passam no filtro. */
export function sumCells(
  cells: readonly InteractionCell[],
  where: (c: InteractionCell) => boolean = () => true,
): number {
  let total = 0;
  for (const c of cells) if (where(c)) total += c.n;
  return total;
}
