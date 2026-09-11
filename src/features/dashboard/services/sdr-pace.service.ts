import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@/lib/supabase/fetch-all-rows';
import { from } from '@/lib/supabase/from';

import { CALL_CONNECTION_COLUMNS, isConnectedCall, type CallConnectionSignals } from '@/features/calls/connection';

import type { SdrPaceMetrics } from '../types';
import { meetingsHeldWindowFilter } from '../utils/meetings-held-window';
import { getMonthRange } from './ranking-metrics.service';

/** SDRs que entram na seção: mesmo corte do ranking (papel sdr, ativo ou convidado). */
export async function fetchSdrIds(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  return (data ?? []).map((m) => m.user_id);
}

/**
 * Realizado × meta de UM SDR no mês — os 5 volumes da seção "SDR selecionado".
 * Cada número usa a mesma fonte do card equivalente do ranking, então a seção
 * e o ranking nunca divergem:
 *  - Leads Abertos: RPC `count_leads_opened_by_sdr` (1º toque humano, dono do lead);
 *  - Reuniões Marcadas: `leads.meeting_scheduled_at` no mês, sem arquivado/deletado;
 *  - Reuniões Realizadas: `meeting_held_at` + `meetingsHeldWindowFilter`;
 *  - Ligações: `calls` outbound do SDR (`user_id`) no mês — discador + Callface,
 *    igual ao Sales Hub; conectadas pela regra única `isConnectedCall`.
 */
export async function fetchSdrPaceMetrics(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  userId: string,
): Promise<SdrPaceMetrics> {
  const { start, end } = getMonthRange(month);

  const [leadsOpened, meetingsScheduled, meetingsHeld, calls, targets] = await Promise.all([
    countLeadsOpened(supabase, orgId, start, end, userId),
    countMeetingsScheduled(supabase, orgId, start, end, userId),
    countMeetingsHeld(supabase, orgId, start, end, userId),
    countCalls(supabase, orgId, start, end, userId),
    fetchTargets(supabase, orgId, month, userId),
  ]);

  return {
    actual: {
      leadsOpened,
      meetingsScheduled,
      meetingsHeld,
      calls: calls.total,
      callsConnected: calls.connected,
    },
    target: targets,
  };
}

async function countLeadsOpened(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  userId: string,
): Promise<number> {
  const { data, error } = (await (supabase.rpc as any)('count_leads_opened_by_sdr', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: null,
  })) as { data: Array<{ performer_id: string; cnt: number }> | null; error: { message: string } | null };
  if (error) throw new Error(`count_leads_opened_by_sdr: ${error.message}`);
  return Number((data ?? []).find((r) => r.performer_id === userId)?.cnt ?? 0);
}

async function countMeetingsScheduled(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  userId: string,
): Promise<number> {
  const { count, error } = (await from(supabase, 'leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('assigned_to', userId)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .not('meeting_scheduled_at', 'is', null)
    .gte('meeting_scheduled_at', start)
    .lt('meeting_scheduled_at', end)) as { count: number | null; error: { message: string } | null };
  if (error) throw new Error(`meetings scheduled: ${error.message}`);
  return count ?? 0;
}

async function countMeetingsHeld(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  userId: string,
): Promise<number> {
  const { count, error } = (await from(supabase, 'leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('assigned_to', userId)
    .is('deleted_at', null)
    .not('meeting_held_at', 'is', null)
    .or(meetingsHeldWindowFilter(start, end, new Date().toISOString()))) as {
    count: number | null;
    error: { message: string } | null;
  };
  if (error) throw new Error(`meetings held: ${error.message}`);
  return count ?? 0;
}

async function countCalls(
  supabase: SupabaseClient,
  orgId: string,
  start: string,
  end: string,
  userId: string,
): Promise<{ total: number; connected: number }> {
  // Lê as linhas (não só o count) para aplicar `isConnectedCall` sem reescrever a
  // regra em SQL. Um SDR faz ~1 mil ligações/mês → poucas páginas.
  const { rows } = await fetchAllRows<CallConnectionSignals>(() =>
    from(supabase, 'calls')
      .select(`id, ${CALL_CONNECTION_COLUMNS}`)
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .eq('type', 'outbound')
      .gte('started_at', start)
      .lt('started_at', end)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true }),
  );
  return { total: rows.length, connected: rows.filter(isConnectedCall).length };
}

async function fetchTargets(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  userId: string,
): Promise<SdrPaceMetrics['target']> {
  const { data, error } = (await from(supabase, 'goals_per_user')
    .select('leads_opened_target, meetings_scheduled_target, meetings_held_target, calls_target, calls_connected_target')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('month', `${month}-01`)
    .maybeSingle()) as {
    data: {
      leads_opened_target: number | null;
      meetings_scheduled_target: number | null;
      meetings_held_target: number | null;
      calls_target: number | null;
      calls_connected_target: number | null;
    } | null;
    error: { message: string } | null;
  };
  // Erro não vira "sem meta": zeraria as metas em silêncio (ex.: coluna nova
  // ainda não aplicada no banco).
  if (error) throw new Error(`goals_per_user: ${error.message}`);
  return {
    leadsOpened: data?.leads_opened_target ?? 0,
    meetingsScheduled: data?.meetings_scheduled_target ?? 0,
    meetingsHeld: data?.meetings_held_target ?? 0,
    calls: data?.calls_target ?? 0,
    callsConnected: data?.calls_connected_target ?? 0,
  };
}
