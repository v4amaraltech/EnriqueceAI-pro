'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';
import { escapeCsvField } from '@/lib/utils/csv';
import { formatDuration } from '@/lib/utils/format';

import { callFiltersSchema } from '../schemas/call.schemas';
import type { CallRow } from '../types';

/** Só as colunas do CSV (`select('*')` trazia ~1,3 KB/linha por causa do `metadata`). */
type ExportRow = Pick<
  CallRow,
  | 'status'
  | 'type'
  | 'origin'
  | 'destination'
  | 'started_at'
  | 'duration_seconds'
  | 'cost'
  | 'is_important'
  | 'notes'
> & { provider: string | null };

const statusLabels: Record<string, string> = {
  significant: 'Significativa',
  not_significant: 'Não Significativa',
  no_contact: 'Sem Contato',
  busy: 'Ocupado',
  not_connected: 'Não Conectada',
};

const typeLabels: Record<string, string> = {
  inbound: 'Recebida',
  outbound: 'Realizada',
  manual: 'Manual',
};

export async function exportCallsCsv(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<{ csv: string; filename: string }>> {
  const parsed = callFiltersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }
  const filters = parsed.data;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Fora do builder: todas as páginas usam o mesmo início de período.
  const now = new Date();

  // Refeita a cada página (os builders do supabase-js são de uso único).
  const buildQuery = () => {
    let query = from(supabase, 'calls')
      .select(
        'id, status, type, origin, destination, started_at, duration_seconds, cost, is_important, notes, provider:metadata->>provider',
      )
      .eq('org_id', orgId);

    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.provider === 'whatsapp') {
      query = query.eq('metadata->>provider', 'whatsapp');
    } else if (filters.provider === 'api4com') {
      query = query.or('metadata->>provider.is.null,metadata->>provider.neq.whatsapp');
    }
    if (filters.user_id) {
      query = query.eq('user_id', filters.user_id);
    }
    if (filters.important_only) {
      query = query.eq('is_important', true);
    }

    if (filters.period === 'today') {
      // BRT midnight: shift "now" by -3h, truncate to date, shift back to get 03:00Z
      const nowBrt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const start = new Date(
        Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) +
          3 * 60 * 60 * 1000,
      ).toISOString();
      query = query.gte('started_at', start);
    } else if (filters.period === 'week') {
      const start = new Date(now);
      start.setDate(start.getDate() - 7);
      query = query.gte('started_at', start.toISOString());
    } else if (filters.period === 'month') {
      // BRT midnight of first day of month
      const nowBrt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const start = new Date(
        Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), 1) + 3 * 60 * 60 * 1000,
      ).toISOString();
      query = query.gte('started_at', start);
    }

    if (filters.search) {
      const term = sanitizeFilterValue(filters.search.replace(/[%_]/g, ''));
      query = query.or(`origin.ilike.%${term}%,destination.ilike.%${term}%,notes.ilike.%${term}%`);
    }

    return query.order('started_at', { ascending: false }).order('id', { ascending: false });
  };

  // Todas as ligações do filtro, em páginas. Antes era `.limit(5000)`: "Todas"
  // (~40 mil na V4 Amaral) e um mês cheio (~12 mil) saíam cortados sem aviso.
  let calls: ExportRow[];
  try {
    const { rows, truncated } = await fetchAllRows<ExportRow>(buildQuery);
    if (truncated) {
      return {
        success: false,
        error: 'Ligações demais para um arquivo só — filtre um período menor',
      };
    }
    calls = rows;
  } catch {
    return { success: false, error: 'Erro ao exportar ligações' };
  }

  const header = [
    'Status',
    'Tipo',
    'Origem',
    'Destino',
    'Data',
    'Duração',
    'Custo',
    'Importante',
    'Notas',
  ];
  const rows = calls.map((c) => [
    escapeCsvField(statusLabels[c.status] ?? c.status),
    escapeCsvField(typeLabels[c.type] ?? c.type),
    escapeCsvField(c.origin === 'whatsapp' || c.provider === 'whatsapp' ? 'WhatsApp' : c.origin),
    escapeCsvField(c.destination),
    new Date(c.started_at).toLocaleString('pt-BR'),
    formatDuration(c.duration_seconds),
    c.cost != null ? c.cost.toFixed(2) : '',
    c.is_important ? 'Sim' : 'Não',
    escapeCsvField(c.notes ?? ''),
  ]);

  const csv = [header.join(','), ...rows.map((r) => r.join(','))].join('\n');
  const date = new Date().toISOString().slice(0, 10);
  const filename = `ligacoes-${date}.csv`;

  return { success: true, data: { csv, filename } };
}
