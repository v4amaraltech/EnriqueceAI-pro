import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import { OVERDUE_THRESHOLD_MS } from '@/features/activities/utils/overdue';

import { expectedByBusinessDay, seriesTargetForDay } from '../utils/pacing';
import { currentDayOfMonthBrt } from '../utils/brt-now';
import { meetingsHeldWindowFilter } from '../utils/meetings-held-window';
import type {
  DailyDataPoint,
  DashboardFilters,
  RankingCardData,
  RankingData,
  SdrRankingEntry,
} from '../types';

function getMonthRange(month: string): { start: string; end: string } {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(year, mon, 0).getDate();
  // Janela de CONTAGEM = mês inteiro → total, ranking por SDR e série contam até HOJE
  // (as datas de evento são sempre <= agora, nunca futuras). Número grande e último
  // ponto do gráfico batem entre si e com o Sales Hub. ⚠️ NÃO recuar para "ontem": o
  // PACING ("esperado"/%/ideal-dia) é que usa o dia fechado (`currentDayOfMonthBrt` =
  // ontem) — contagem e pacing são réguas DIFERENTES de propósito (nº hoje × meta ontem).
  return {
    start: `${year}-${String(mon).padStart(2, '0')}-01T03:00:00Z`,
    end: `${year}-${String(mon).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
  };
}

function getDateRange(filters: DashboardFilters): { start: string; end: string } {
  if (filters.dateFrom && filters.dateTo) {
    return {
      start: `${filters.dateFrom}T03:00:00Z`,
      end: `${filters.dateTo}T23:59:59-03:00`,
    };
  }
  return getMonthRange(filters.month);
}

function getDaysInMonth(month: string): number {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(year, mon, 0).getDate();
}

function computePercentOfTarget(actual: number, target: number, _days: number, month: string): number {
  if (target <= 0) return 0;
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const currentDay = currentDayOfMonthBrt(month);
  const expectedByToday = expectedByBusinessDay(target, yr, mo, currentDay);
  if (expectedByToday <= 0) return 0;
  return Math.round(((actual - expectedByToday) / expectedByToday) * 100);
}

/**
 * Ideal por SDR acumulado até hoje: fatia da meta que cada SDR deveria ter
 * atingido no ritmo de dias úteis (sem feriados). Meta org ÷ nº de SDRs ativos,
 * paceada até o dia de hoje (BRT). `undefined` quando não há meta ou SDRs — aí
 * a coluna "ideal dia" não é exibida.
 */
function computeIdealToDate(
  monthTarget: number,
  activeSdrCount: number,
  month: string,
): number | undefined {
  if (monthTarget <= 0 || activeSdrCount <= 0) return undefined;
  const [yr, mo] = month.split('-').map(Number) as [number, number];
  const currentDay = currentDayOfMonthBrt(month);
  const perSdr = monthTarget / activeSdrCount;
  return Math.round(expectedByBusinessDay(perSdr, yr, mo, currentDay));
}

/**
 * Nº de SDRs no divisor do "ideal dia": SDRs ativos que TÊM meta individual
 * (`goals_per_user.opportunity_target > 0`) no mês. SDRs sem meta individual
 * (ex.: recém-adicionados, ainda sem alvo) não diluem a meta da org. Fallback:
 * se nenhum SDR ativo tem meta individual, usa o total de SDRs ativos — evita
 * dividir por zero e esconder a coluna em orgs que nunca definiram metas
 * individuais.
 */
async function countSdrsForIdeal(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  sdrIds: Set<string>,
): Promise<number> {
  const monthStart = `${month}-01`;
  const { data } = (await from(supabase, 'goals_per_user')
    .select('user_id, opportunity_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .gt('opportunity_target', 0)) as {
    data: Array<{ user_id: string; opportunity_target: number }> | null;
  };
  const withGoal = (data ?? []).filter(
    (g) => sdrIds.has(g.user_id) && g.opportunity_target > 0,
  ).length;
  return withGoal > 0 ? withGoal : sdrIds.size;
}

/**
 * Metas individuais por SDR no mês (leads abertos, reuniões marcadas ou
 * realizadas). Retorna apenas quem tem meta > 0 — SDR sem meta individual cai
 * no ideal compartilhado (fatia da meta org ÷ nº de SDRs).
 */
async function fetchIndividualTargets(
  supabase: SupabaseClient,
  orgId: string,
  month: string,
  column: 'leads_opened_target' | 'meetings_scheduled_target' | 'meetings_held_target',
): Promise<Map<string, number>> {
  const monthStart = `${month}-01`;
  const { data } = (await from(supabase, 'goals_per_user')
    .select(`user_id, ${column}`)
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .gt(column, 0)) as { data: Array<Record<string, unknown>> | null };
  const map = new Map<string, number>();
  for (const row of data ?? []) {
    const userId = row.user_id as string;
    const target = Number(row[column] ?? 0);
    if (userId && target > 0) map.set(userId, target);
  }
  return map;
}

function buildRankingCardData(
  entries: SdrRankingEntry[],
  total: number,
  monthTarget: number,
  month: string,
  activeSdrCount?: number,
  individualTargets?: Map<string, number>,
): RankingCardData {
  const days = getDaysInMonth(month);
  const sdrCount = entries.length || 1;
  // Ideal compartilhado: fatia da meta org ÷ nº de SDRs (comportamento padrão
  // dos cards e fallback pra SDR sem meta individual de reuniões).
  const sharedIdeal =
    activeSdrCount != null ? computeIdealToDate(monthTarget, activeSdrCount, month) : undefined;

  const sorted = entries.sort((a, b) => b.value - a.value);
  let sdrBreakdown = sorted;
  if (individualTargets) {
    const [yr, mo] = month.split('-').map(Number) as [number, number];
    const currentDay = currentDayOfMonthBrt(month);
    sdrBreakdown = sorted.map((e) => {
      const indiv = individualTargets.get(e.userId);
      return {
        ...e,
        idealToDate:
          indiv && indiv > 0
            ? Math.round(expectedByBusinessDay(indiv, yr, mo, currentDay))
            : sharedIdeal,
      };
    });
  }

  return {
    total,
    monthTarget,
    percentOfTarget: computePercentOfTarget(total, monthTarget, days, month),
    averagePerSdr: Math.round(total / sdrCount),
    sdrBreakdown,
    idealToDate: sharedIdeal,
  };
}

/**
 * Card 1: Leads Finalizados — enrollments completed/replied, attributed to lead's assigned_to
 * Only counts users with role='sdr' — managers are excluded.
 */
export async function fetchLeadsFinishedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs in the org (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Query enrollments in the period with lead_id for attribution
  let query = from(supabase, 'cadence_enrollments')
    .select('lead_id, enrolled_by, status')
    .eq('org_id', orgId)
    .limit(10000);

  query = query.gte('enrolled_at', start).lt('enrolled_at', end);

  if (filters.cadenceIds.length > 0) {
    query = query.in('cadence_id', filters.cadenceIds);
  }

  const { data: enrollments } = (await query) as {
    data: Array<{ lead_id: string; enrolled_by: string; status: string }> | null;
  };

  const rows = enrollments ?? [];
  if (rows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('opportunity_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { opportunity_target: number } | null };
    return buildRankingCardData([], 0, goal?.opportunity_target ?? 0, filters.month);
  }

  // Get lead assigned_to for attribution. Archived leads are skipped — they
  // were discarded and shouldn't count as "finalizados" or "prospectando".
  const leadIds = [...new Set(rows.map((r) => r.lead_id))];
  const leadData = await chunkedIn<{ id: string; assigned_to: string | null }>(leadIds, (chunk) =>
    from(supabase, 'leads')
      .select('id, assigned_to')
      .in('id', chunk)
      .is('deleted_at', null)
      .neq('status', 'archived') as unknown as PromiseLike<{
      data: Array<{ id: string; assigned_to: string | null }> | null;
      error: unknown;
    }>,
  );
  const leadAssignedTo = new Map(leadData.map((l) => [l.id, l.assigned_to]));

  // Group by SDR (use lead's assigned_to, fallback to enrolled_by only if SDR)
  const sdrMap = new Map<string, { finished: number; prospecting: number }>();
  for (const e of rows) {
    const assignedTo = leadAssignedTo.get(e.lead_id);
    // Prefer assigned_to if it's an SDR; fallback to enrolled_by only if it's an SDR
    let sdr: string | null = null;
    if (assignedTo && sdrIds.has(assignedTo)) sdr = assignedTo;
    else if (e.enrolled_by && sdrIds.has(e.enrolled_by)) sdr = e.enrolled_by;
    if (!sdr) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    const entry = sdrMap.get(sdr) ?? { finished: 0, prospecting: 0 };
    if (e.status === 'completed' || e.status === 'replied') {
      entry.finished++;
    } else if (e.status === 'active') {
      entry.prospecting++;
    }
    sdrMap.set(sdr, entry);
  }

  const entries: SdrRankingEntry[] = [];
  let totalFinished = 0;
  for (const [userId, counts] of sdrMap) {
    totalFinished += counts.finished;
    entries.push({
      userId,
      userName: '',
      value: counts.finished,
      secondaryValue: counts.prospecting,
    });
  }

  // Get org goal for leads_finished_target
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('leads_finished_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { leads_finished_target: number } | null };

  return buildRankingCardData(entries, totalFinished, goal?.leads_finished_target ?? 0, filters.month);
}

/**
 * Card 2: Atividades Realizadas — interactions count by SDR (via performed_by)
 * Only counts users with role='sdr' — managers are excluded.
 */
export async function fetchActivitiesRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Get activity counts per performer using SQL GROUP BY (efficient at any scale)
  const { data: activityCounts } = await (supabase.rpc as any)('count_activities_by_performer', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; cnt: number }> | null };

  const rows = activityCounts ?? [];

  if (rows.length === 0) {
    const monthStart = `${filters.month}-01`;
    const { data: goal } = (await from(supabase, 'goals')
      .select('activities_target')
      .eq('org_id', orgId)
      .eq('month', monthStart)
      .maybeSingle()) as { data: { activities_target: number } | null };

    return buildRankingCardData([], 0, goal?.activities_target ?? 0, filters.month);
  }

  const entries: SdrRankingEntry[] = [];
  let totalActivities = 0;
  for (const row of rows) {
    if (!sdrIds.has(row.performer_id)) continue; // Exclude managers
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    totalActivities += row.cnt;
    entries.push({ userId: row.performer_id, userName: '', value: row.cnt });
  }

  // Get goal
  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('activities_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { activities_target: number } | null };

  return buildRankingCardData(entries, totalActivities, goal?.activities_target ?? 0, filters.month);
}

/**
 * Card 3: Taxa de Comparecimento (Marcada → Realizada). Numerador = reuniões
 * realizadas; denominador = reuniões marcadas no período, ambos por SDR. O
 * inverso desta taxa é o no-show. Calculada em memória a partir dos cards de
 * Reuniões Marcadas e Realizadas — mesmo padrão do Hit Rate, sem RPC própria.
 *
 * Aproximação temporal (idêntica à do Hit Rate): marcadas e realizadas são
 * contadas dentro da janela do filtro; não rastreamos se a reunião específica
 * marcada no período foi a mesma realizada. Por isso a taxa pode passar de
 * 100% quando há acúmulo de reuniões marcadas em meses anteriores sendo
 * realizadas agora.
 */
export function fetchAttendanceRateRanking(
  scheduled: RankingCardData,
  held: RankingCardData,
): RankingCardData {
  const scheduledByUser = new Map<string, number>();
  for (const e of scheduled.sdrBreakdown) scheduledByUser.set(e.userId, e.value);
  const heldByUser = new Map<string, number>();
  for (const e of held.sdrBreakdown) heldByUser.set(e.userId, e.value);

  const allUserIds = new Set<string>([...scheduledByUser.keys(), ...heldByUser.keys()]);
  const entries: SdrRankingEntry[] = [];
  let totalScheduled = 0;
  let totalHeld = 0;
  for (const userId of allUserIds) {
    const sc = scheduledByUser.get(userId) ?? 0;
    const hd = heldByUser.get(userId) ?? 0;
    totalScheduled += sc;
    totalHeld += hd;
    const rate = sc > 0 ? Math.round((hd / sc) * 100) : 0;
    entries.push({ userId, userName: '', value: rate, secondaryValue: hd });
  }

  const overallRate = totalScheduled > 0 ? Math.round((totalHeld / totalScheduled) * 100) : 0;
  const sdrCount = entries.length || 1;

  // Meta derivada das metas dos dois cards: se a empresa espera marcar N
  // reuniões e realizar M, a taxa de comparecimento alvo é M/N. Mesma lógica
  // do Hit Rate — evita o usuário definir um número solto e desalinhado.
  const derivedTarget = scheduled.monthTarget > 0 && held.monthTarget > 0
    ? Math.round((held.monthTarget / scheduled.monthTarget) * 100)
    : 0;
  const percentOfTarget = derivedTarget > 0
    ? Math.round(((overallRate - derivedTarget) / derivedTarget) * 100)
    : 0;

  return {
    total: overallRate,
    monthTarget: derivedTarget,
    percentOfTarget,
    averagePerSdr: Math.round((entries.reduce((s, e) => s + e.value, 0) / sdrCount) * 10) / 10,
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Card 4: Leads Abertos — first human-channel touch per lead, attributed to
 * the SDR who did it. Includes a daily cumulative breakdown for the chart.
 */
export async function fetchLeadsOpenedRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  // Get list of SDRs (exclude managers)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // RPC returns one row per SDR with count of leads whose FIRST human-channel
  // interaction falls in [start, end). See migration
  // 20260522091423_goals_leads_opened_target_and_rpc.sql.
  const { data: rows } = await (supabase.rpc as any)('count_leads_opened_by_sdr', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; cnt: number }> | null };

  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('leads_opened_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { leads_opened_target: number } | null };
  const monthTarget = goal?.leads_opened_target ?? 0;

  const entries: SdrRankingEntry[] = [];
  let totalOpened = 0;
  for (const row of rows ?? []) {
    if (!sdrIds.has(row.performer_id)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    totalOpened += row.cnt;
    entries.push({ userId: row.performer_id, userName: '', value: row.cnt });
  }

  // Daily cumulative chart: pull the same first-touch rows but bucket by day.
  // Reuses the RPC's filter contract via a direct SQL select on the same
  // interactions slice. We do it client-side because the RPC already aggregates.
  const dailyData = await fetchLeadsOpenedDaily(supabase, orgId, filters, sdrIds, monthTarget);

  const idealSdrCount = await countSdrsForIdeal(supabase, orgId, filters.month, sdrIds);
  const individualTargets = await fetchIndividualTargets(
    supabase,
    orgId,
    filters.month,
    'leads_opened_target',
  );
  const card = buildRankingCardData(
    entries,
    totalOpened,
    monthTarget,
    filters.month,
    idealSdrCount,
    individualTargets,
  );
  return { ...card, dailyData };
}

/**
 * Per-day cumulative count of leads opened (first human touch). Mirrors the
 * RPC's window filter so the chart matches the ranking total exactly.
 */
async function fetchLeadsOpenedDaily(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
  sdrIds: Set<string>,
  target: number,
): Promise<DailyDataPoint[]> {
  const { start, end } = getDateRange(filters);
  const days = getDaysInMonth(filters.month);
  const [year, mon] = filters.month.split('-').map(Number) as [number, number];
  // Série vai até HOJE (dia corrente), mesma régua da janela de contagem — último
  // ponto = número grande. Dias futuros ficam null. (Pacing usa régua separada: ontem.)
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isCurrentMonth = nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === mon;
  const maxDay = isCurrentMonth ? nowBrt.getUTCDate() : days;

  // chunked here would only kick in for huge cadenceIds; for the daily series
  // we just pull leads opened in the window and bucket in memory.
  const { data: rpcRows } = await (supabase.rpc as any)('count_leads_opened_by_sdr_daily', {
    p_org_id: orgId,
    p_start: start,
    p_end: end,
    p_cadence_ids: filters.cadenceIds.length > 0 ? filters.cadenceIds : null,
  }) as { data: Array<{ performer_id: string; opened_at: string }> | null };

  const countByDay = new Map<number, number>();
  for (const row of rpcRows ?? []) {
    if (!sdrIds.has(row.performer_id)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(row.performer_id)) continue;
    const brt = new Date(new Date(row.opened_at).getTime() - 3 * 60 * 60 * 1000);
    const day = brt.getUTCDate();
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  const result: DailyDataPoint[] = [];
  let cumulative = 0;
  for (let day = 1; day <= days; day++) {
    cumulative += countByDay.get(day) ?? 0;
    result.push({
      date: `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      day,
      actual: day <= maxDay ? cumulative : null,
      // Meta do ponto: no dia de hoje usa a régua do dia fechado (ontem), igual ao
      // "esperado até hoje" do card — o tooltip de hoje mostra a mesma meta.
      target: seriesTargetForDay(target, year, mon, day, filters.month),
    });
  }
  return result;
}

/**
 * Card 5: Reuniões Marcadas — leads cujo meeting_scheduled_at caiu no período,
 * atribuídos pelo SDR responsável (leads.assigned_to). Arquivados excluídos.
 * Retorna também dailyData pra alimentar o KPI card no topo do dashboard.
 */
export async function fetchMeetingsScheduledRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);
  const days = getDaysInMonth(filters.month);

  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  const { data: rows } = (await from(supabase, 'leads')
    .select('id, assigned_to, meeting_scheduled_at')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .not('meeting_scheduled_at', 'is', null)
    .gte('meeting_scheduled_at', start)
    .lt('meeting_scheduled_at', end)
    .limit(10000)) as { data: Array<{ id: string; assigned_to: string | null; meeting_scheduled_at: string }> | null };

  const counts = new Map<string, number>();
  const countByDay = new Map<number, number>();
  let total = 0;
  for (const lead of rows ?? []) {
    const sdr = lead.assigned_to;
    if (!sdr || !sdrIds.has(sdr)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    counts.set(sdr, (counts.get(sdr) ?? 0) + 1);
    total++;
    const brt = new Date(new Date(lead.meeting_scheduled_at).getTime() - 3 * 60 * 60 * 1000);
    const day = brt.getUTCDate();
    countByDay.set(day, (countByDay.get(day) ?? 0) + 1);
  }

  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('meetings_scheduled_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { meetings_scheduled_target: number | null } | null };
  const monthTarget = goal?.meetings_scheduled_target ?? 0;

  const entries: SdrRankingEntry[] = [];
  for (const [userId, value] of counts) {
    entries.push({ userId, userName: '', value });
  }
  const idealSdrCount = await countSdrsForIdeal(supabase, orgId, filters.month, sdrIds);
  const individualTargets = await fetchIndividualTargets(
    supabase,
    orgId,
    filters.month,
    'meetings_scheduled_target',
  );
  const card = buildRankingCardData(
    entries,
    total,
    monthTarget,
    filters.month,
    idealSdrCount,
    individualTargets,
  );

  // Daily cumulative for the KPI chart — série vai até HOJE (dia corrente), mesma
  // régua da janela de contagem, pra o último ponto = número grande. (Pacing = ontem.)
  const [year, mon] = filters.month.split('-').map(Number) as [number, number];
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isCurrent = nowBrt.getUTCFullYear() === year && nowBrt.getUTCMonth() + 1 === mon;
  const maxDay = isCurrent ? nowBrt.getUTCDate() : days;
  const dailyData = [] as Array<{ date: string; day: number; actual: number | null; target: number }>;
  let cumulative = 0;
  for (let d = 1; d <= days; d++) {
    cumulative += countByDay.get(d) ?? 0;
    dailyData.push({
      date: `${year}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      day: d,
      actual: d <= maxDay ? cumulative : null,
      // Meta do ponto: no dia de hoje usa a régua do dia fechado (ontem), igual ao
      // "esperado até hoje" do card — o tooltip de hoje mostra a mesma meta.
      target: seriesTargetForDay(monthTarget, year, mon, d, filters.month),
    });
  }
  return { ...card, dailyData };
}

/**
 * Card 6: Reuniões Realizadas — reuniões que ACONTECERAM no período, contadas
 * pelo horário do evento (ou pelo carimbo, quando não há evento registrado) e
 * provadas pelo carimbo (`meeting_held_at` não nulo). Mesma janela do KPI —
 * ver meetingsHeldWindowFilter. Sem filtro de status: reunião que aconteceu e
 * depois foi desqualificada continua contando pro SDR.
 * Atribuição via leads.assigned_to (SDR responsável) — mesma regra do KPI.
 */
export async function fetchMeetingsHeldRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { start, end } = getDateRange(filters);

  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  const { data: rows } = (await from(supabase, 'leads')
    .select('id, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .not('meeting_held_at', 'is', null)
    .or(meetingsHeldWindowFilter(start, end, new Date().toISOString()))
    .limit(10000)) as { data: Array<{ id: string; assigned_to: string | null }> | null };

  const counts = new Map<string, number>();
  let total = 0;
  for (const lead of rows ?? []) {
    const sdr = lead.assigned_to;
    if (!sdr || !sdrIds.has(sdr)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(sdr)) continue;
    counts.set(sdr, (counts.get(sdr) ?? 0) + 1);
    total++;
  }

  const monthStart = `${filters.month}-01`;
  const { data: goal } = (await from(supabase, 'goals')
    .select('meetings_held_target')
    .eq('org_id', orgId)
    .eq('month', monthStart)
    .maybeSingle()) as { data: { meetings_held_target: number } | null };

  const entries: SdrRankingEntry[] = [];
  for (const [userId, value] of counts) {
    entries.push({ userId, userName: '', value });
  }
  const idealSdrCount = await countSdrsForIdeal(supabase, orgId, filters.month, sdrIds);
  const individualTargets = await fetchIndividualTargets(
    supabase,
    orgId,
    filters.month,
    'meetings_held_target',
  );
  return buildRankingCardData(
    entries,
    total,
    goal?.meetings_held_target ?? 0,
    filters.month,
    idealSdrCount,
    individualTargets,
  );
}

/**
 * Card 7: Hit Rate (Aberto → Realizada). Numerador = reuniões realizadas;
 * denominador = leads abertos no período (primeira interaction humana),
 * ambos atribuídos via leads.assigned_to.
 */
export function fetchHitRateRanking(
  opened: RankingCardData,
  held: RankingCardData,
): RankingCardData {
  const openedByUser = new Map<string, number>();
  for (const e of opened.sdrBreakdown) openedByUser.set(e.userId, e.value);
  const heldByUser = new Map<string, number>();
  for (const e of held.sdrBreakdown) heldByUser.set(e.userId, e.value);

  const allUserIds = new Set<string>([...openedByUser.keys(), ...heldByUser.keys()]);
  const entries: SdrRankingEntry[] = [];
  let totalOpened = 0;
  let totalHeld = 0;
  for (const userId of allUserIds) {
    const op = openedByUser.get(userId) ?? 0;
    const hd = heldByUser.get(userId) ?? 0;
    totalOpened += op;
    totalHeld += hd;
    const rate = op > 0 ? Math.round((hd / op) * 100) : 0;
    entries.push({ userId, userName: '', value: rate, secondaryValue: hd });
  }

  const overallRate = totalOpened > 0 ? Math.round((totalHeld / totalOpened) * 100) : 0;
  const sdrCount = entries.length || 1;

  // Meta derivada das metas dos outros dois cards: se a empresa espera
  // abrir N leads e realizar M reuniões, a hit rate alvo é M/N. Evita o
  // usuário definir um número solto que não casa com os outros dois.
  const derivedTarget = opened.monthTarget > 0 && held.monthTarget > 0
    ? Math.round((held.monthTarget / opened.monthTarget) * 100)
    : 0;
  const percentOfTarget = derivedTarget > 0
    ? Math.round(((overallRate - derivedTarget) / derivedTarget) * 100)
    : 0;

  return {
    total: overallRate,
    monthTarget: derivedTarget,
    percentOfTarget,
    averagePerSdr: Math.round((entries.reduce((s, e) => s + e.value, 0) / sdrCount) * 10) / 10,
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Card 8: Leads para Abrir — snapshot da fila de cada SDR. Conta leads
 * status='new' (não deletados) atribuídos ao SDR que NÃO estão em cadência
 * agora (sem enrollment ativo nem pausado). Entra também o lead que já passou
 * por uma cadência e voltou para "Novo" (Recovery, redistribuição) — o SDR
 * precisa abri-lo de novo.
 *
 * Fonte única: a view `leads_no_active_enrollment`, a MESMA do filtro
 * "Sem cadência" da tela de Leads e da RPC get_sdr_leads_para_abrir_v2
 * (Sales Hub). Os três números batem. Decisão do gestor em 10/set/2026
 * (antes contava só lead que NUNCA teve cadência).
 *
 * Uma contagem `head` por SDR: número exato, sem baixar linhas nem esbarrar
 * no teto de linhas do PostgREST. Não tem meta.
 */
export async function fetchLeadsToOpenRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };

  const sdrIds = (sdrs ?? [])
    .map((s) => s.user_id)
    .filter((id) => filters.userIds.length === 0 || filters.userIds.includes(id));

  const counts = await Promise.all(
    sdrIds.map(async (userId) => {
      const { count, error } = (await from(supabase, 'leads_no_active_enrollment')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('assigned_to', userId)
        .eq('status', 'new')
        .is('deleted_at', null)) as { count: number | null; error: { message: string } | null };
      // Não derruba os outros 8 cards (rodam no mesmo Promise.all): registra e segue.
      if (error) console.error(`fetchLeadsToOpenRanking(${userId}):`, error.message);
      return { userId, value: count ?? 0 };
    }),
  );

  const entries: SdrRankingEntry[] = counts
    .filter((c) => c.value > 0)
    .map((c) => ({ userId: c.userId, userName: '', value: c.value }));
  const total = entries.reduce((s, e) => s + e.value, 0);

  // Sem meta — é snapshot da fila atual. percentOfTarget = 0.
  const sdrCount = entries.length || 1;
  return {
    total,
    monthTarget: 0,
    percentOfTarget: 0,
    averagePerSdr: Math.round(total / sdrCount),
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Snapshot: TAREFAS (passos de cadência) atrasadas por SDR, contando uma linha
 * por passo vencido — a MESMA unidade da fila de Execução (/atividades),
 * "Atividades das Cadências (N)" com o filtro "Atrasada". Deriva do RPC
 * list_overdue_activities_brt, que espelha fetch-pending-activities (expansão
 * dos passos na janela de 24h + supressões) e aplica o threshold compartilhado
 * (OVERDUE_THRESHOLD_HOURS — atualmente 4h, via effective_due_brt). Um lead com
 * 3 passos vencidos conta 3 aqui — o card bate 1:1 com a tela do SDR. Sem meta
 * (snapshot atual).
 *
 * Trigger `skip_weekend_brt` no `calculate_next_step_due` empurra sáb/dom
 * pra segunda 9h BRT, então sex 18h não vira atrasada na seg 8h.
 */
export async function fetchOverdueActivitiesRanking(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingCardData> {
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  const cutoffIso = new Date(Date.now() - OVERDUE_THRESHOLD_MS).toISOString();

  // Count overdue TASKS (cadence steps), not leads — matching what the SDR sees
  // on the execution screen ("Atividades das Cadências (N)" com filtro "Atrasada").
  // list_overdue_activities_brt mirrors fetch-pending-activities: it expands each
  // active enrollment into every step within the 24h window and flags each step
  // overdue past the 4h business-hours threshold (effective_due_brt < cutoff),
  // applying the same suppressions (auto_email, WhatsApp/Ligação-WhatsApp inválido,
  // passo já executado). A lead with 3 overdue steps counts 3 here — one row per
  // task — so the card reconciles 1:1 with the SDR queue. The RPC already returns
  // assigned_to, so no second lead query is needed.
  const { data: rows } = (await (supabase.rpc as never as (fn: string, args: object) => Promise<{
    data: Array<{ assigned_to: string | null }> | null;
    error: { message: string } | null;
  }>)('list_overdue_activities_brt', {
    p_org_id: orgId,
    p_cutoff: cutoffIso,
  }));

  // Tally tasks per SDR (role='sdr' active/invited only, matching the queue's
  // per-SDR filter). No dedupe — the unit is the task/step.
  const tasksBySdr = new Map<string, number>();
  for (const r of rows ?? []) {
    const owner = r.assigned_to;
    if (!owner || !sdrIds.has(owner)) continue;
    if (filters.userIds.length > 0 && !filters.userIds.includes(owner)) continue;
    tasksBySdr.set(owner, (tasksBySdr.get(owner) ?? 0) + 1);
  }

  let total = 0;
  const entries: SdrRankingEntry[] = [];
  for (const [userId, count] of tasksBySdr) {
    entries.push({ userId, userName: '', value: count });
    total += count;
  }

  const sdrCount = entries.length || 1;
  return {
    total,
    monthTarget: 0,
    percentOfTarget: 0,
    averagePerSdr: Math.round(total / sdrCount),
    sdrBreakdown: entries.sort((a, b) => b.value - a.value),
  };
}

/**
 * Fetch all 9 ranking cards in parallel
 */
export async function fetchRankingData(
  supabase: SupabaseClient,
  orgId: string,
  filters: DashboardFilters,
): Promise<RankingData> {
  const [leadsFinished, activitiesDone, leadsOpened, meetingsScheduled, meetingsHeld, leadsToOpen, overdueActivities] = await Promise.all([
    fetchLeadsFinishedRanking(supabase, orgId, filters),
    fetchActivitiesRanking(supabase, orgId, filters),
    fetchLeadsOpenedRanking(supabase, orgId, filters),
    fetchMeetingsScheduledRanking(supabase, orgId, filters),
    fetchMeetingsHeldRanking(supabase, orgId, filters),
    fetchLeadsToOpenRanking(supabase, orgId, filters),
    fetchOverdueActivitiesRanking(supabase, orgId, filters),
  ]);

  // Derived in-memory from the cards above (no extra round-trip).
  const hitRate = fetchHitRateRanking(leadsOpened, meetingsHeld);
  const attendanceRate = fetchAttendanceRateRanking(meetingsScheduled, meetingsHeld);

  return { leadsFinished, activitiesDone, attendanceRate, leadsOpened, meetingsScheduled, meetingsHeld, hitRate, leadsToOpen, overdueActivities };
}
