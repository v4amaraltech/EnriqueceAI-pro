import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { getMonthRange } from '@/features/dashboard/services/ranking-metrics.service';

import { buildCloserMonthStats, type CloserMonthStats } from '../utils/closer-stats';

export interface CockpitCloserRow extends CloserMonthStats {
  name: string;
  email: string;
  schedulingEnabled: boolean;
}

export interface CockpitClosersData {
  month: string;
  closers: CockpitCloserRow[];
  /** `false` enquanto a coluna `scheduling_enabled` não existir no banco. */
  toggleAvailable: boolean;
}

type Rows<T> = Promise<{ data: T[] | null; error: { message: string } | null }>;

/** Closers da org com as reuniões do mês (ver `buildCloserMonthStats`). */
export async function fetchCockpitClosers(orgId: string, month: string): Promise<CockpitClosersData> {
  const supabase = await createServerSupabaseClient();
  const { start, end } = getMonthRange(month);

  type CloserDb = { id: string; name: string; email: string; scheduling_enabled?: boolean };
  let toggleAvailable = true;
  let closersRes = await (from(supabase, 'closers')
    .select('id, name, email, scheduling_enabled')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .order('name', { ascending: true }) as unknown as Rows<CloserDb>);
  if (closersRes.error) {
    // Migration 20261107032426 ainda não aplicada: mostra todos como habilitados.
    toggleAvailable = false;
    closersRes = await (from(supabase, 'closers')
      .select('id, name, email')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .order('name', { ascending: true }) as unknown as Rows<CloserDb>);
  }
  const closers = closersRes.data ?? [];

  const [meetingsRes, cancelledRes] = await Promise.all([
    from(supabase, 'leads')
      .select('closer_id, meeting_held_at, meeting_no_show_at')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .not('closer_id', 'is', null)
      .gte('meeting_starts_at', start)
      .lte('meeting_starts_at', end)
      .limit(10000) as unknown as Rows<{ closer_id: string | null; meeting_held_at: string | null; meeting_no_show_at: string | null }>,
    from(supabase, 'interactions')
      .select('lead:leads!inner(closer_id)')
      .eq('org_id', orgId)
      .eq('metadata->>system_event', 'meeting_cancelled')
      .gte('created_at', start)
      .lte('created_at', end)
      .not('lead.closer_id', 'is', null)
      .limit(10000) as unknown as Rows<{ lead: { closer_id: string | null } | null }>,
  ]);

  if (meetingsRes.error) console.error('[cockpit] reuniões por closer:', meetingsRes.error.message);
  if (cancelledRes.error) console.error('[cockpit] canceladas por closer:', cancelledRes.error.message);

  const cancelled = new Map<string, number>();
  for (const row of cancelledRes.data ?? []) {
    const id = row.lead?.closer_id;
    if (id) cancelled.set(id, (cancelled.get(id) ?? 0) + 1);
  }

  const stats = buildCloserMonthStats(
    closers.map((c) => c.id),
    meetingsRes.data ?? [],
    cancelled,
  );

  const rows: CockpitCloserRow[] = closers
    .map((c) => ({
      ...(stats.get(c.id) ?? { closerId: c.id, total: 0, scheduled: 0, noShow: 0, held: 0, cancelled: 0 }),
      name: c.name,
      email: c.email,
      schedulingEnabled: c.scheduling_enabled ?? true,
    }))
    // Habilitados primeiro, depois quem tem mais reuniões, depois nome.
    .sort(
      (a, b) =>
        Number(b.schedulingEnabled) - Number(a.schedulingEnabled) ||
        b.total - a.total ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );

  return { month, closers: rows, toggleAvailable };
}
