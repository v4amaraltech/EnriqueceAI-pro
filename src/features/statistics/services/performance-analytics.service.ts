import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

import type {
  DailyControlRow,
  DailySdrPerformanceEntry,
  PerformanceAnalyticsData,
  SdrActivityComparisonEntry,
  SdrPerformanceRow,
} from '../types/performance-analytics.types';
import type { LeadQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';
import {
  type InteractionCell,
  type PerformerSummary,
  fetchInteractionCounts,
  sumCells,
} from './interaction-counts';
import { type MemberInfo, buildMemberInfoMap } from './member-lookup';
import { readAllRows } from './read-all-rows';

export async function fetchPerformanceAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<PerformanceAnalyticsData> {
  // Fetch member info map (via admin client — org_members has no email column)
  const infoMap = await buildMemberInfoMap(supabase, orgId);

  // Get member user_ids
  const { data: rawMemberIds } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active')) as { data: { user_id: string }[] | null };
  const memberIds = rawMemberIds ?? [];

  if (memberIds.length === 0) {
    return emptyData();
  }

  const filteredIds = userIds && userIds.length > 0 ? userIds : memberIds.map((m) => m.user_id);

  // Contagens de interações já agrupadas no banco (RPC get_interaction_counts).
  // `channel='system'` são linhas de auditoria (passo pulado, cadência encerrada,
  // avanço automático) gravadas como type='sent'. O Dashboard e o Progresso
  // diário já as excluem; sem este filtro o Controle Diário contava "Pular esta
  // atividade" como atividade concluída. `calendar` (reunião agendada) fica —
  // `completed` conta meeting_scheduled de propósito.
  const { cells, performers } = await fetchInteractionCounts(supabase, {
    periodStart,
    periodEnd,
    excludeChannels: ['system'],
    userIds: filteredIds,
    cadenceId: isUuid(cadenceId) ? cadenceId : undefined,
  });

  // Fetch leads in period (don't filter by assigned_to here — won_by may differ)
  const leads = await readAllRows<LeadQueryRow>('performance: leads do período', () =>
    from(supabase, 'leads')
      .select('id, status, created_by, assigned_to, won_by')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .gte('created_at', periodStart)
      .lte('created_at', periodEnd)
      .order('id', { ascending: true }),
  );

  // memberLookup: user_id → name for display; memberInfoLookup: user_id → full info
  const memberLookup = new Map(
    memberIds.map((m) => [m.user_id, infoMap.get(m.user_id)?.name ?? m.user_id.slice(0, 8)]),
  );
  const memberInfoLookup = new Map(memberIds.map((m) => [m.user_id, infoMap.get(m.user_id)]));

  const totalActivities = sumCells(cells);
  // Filter leads belonging to filtered SDRs (by assigned_to)
  const filteredLeads = leads.filter((l) => l.assigned_to && filteredIds.includes(l.assigned_to));
  const totalLeadsCreated = filteredLeads.length;
  // Qualified counts the SAME population as the denominator (leads assigned to
  // the filtered SDRs) so the rate can never exceed 100%. Previously the
  // numerator attributed by `won_by ?? assigned_to` while the denominator used
  // `assigned_to` — a lead assigned outside the filter but won inside it
  // inflated the numerator only, pushing qualificationRate past 100%.
  // 'won' is a downstream stage of 'qualified', so both count here.
  const totalQualified = filteredLeads.filter(
    (l) => l.status === 'qualified' || l.status === 'won',
  ).length;

  // Build lookup maps once — O(n) instead of O(n×m) per member
  const cellsByUser = groupBy(cells, (c) => c.performed_by ?? '');
  const leadsByAssignee = groupBy(leads, (l) => l.assigned_to ?? '');

  const sdrTable = buildSdrTable(filteredIds, memberLookup, cellsByUser, leadsByAssignee);
  const sdrComparison = buildSdrComparison(sdrTable);
  const { dailySdrTrend, dailySdrKeys } = buildDailySdrTrend(cells, memberLookup);

  const dailyControl = buildDailyControl(
    filteredIds,
    memberLookup,
    memberInfoLookup,
    cellsByUser,
    performers,
    leadsByAssignee,
  );

  return {
    totalActivities,
    totalLeadsCreated,
    totalQualified,
    qualificationRate: safeRate(totalQualified, totalLeadsCreated),
    sdrTable,
    sdrComparison,
    dailySdrTrend,
    dailySdrKeys,
    dailyControl,
  };
}

function buildSdrTable(
  memberIds: string[],
  memberLookup: Map<string, string>,
  cellsByUser: Map<string, InteractionCell[]>,
  leadsByAssignee: Map<string, LeadQueryRow[]>,
): SdrPerformanceRow[] {
  return memberIds
    .map((userId) => {
      const userEmail = memberLookup.get(userId) ?? userId.slice(0, 8);
      const userCells = cellsByUser.get(userId) ?? [];
      const userLeads = leadsByAssignee.get(userId) ?? [];
      // Qualified counts the user's OWN leads (assigned_to === userId, i.e.
      // userLeads) that reached qualified/won — same population as the
      // denominator (userLeads.length), so the per-SDR rate stays ≤100%.
      // (Was attributing by `won_by ?? assigned_to` against an assigned_to
      // denominator, which could exceed 100%.)
      const qualified = userLeads.filter(
        (l) => l.status === 'qualified' || l.status === 'won',
      ).length;
      const meetings = sumCells(userCells, (c) => c.type === 'meeting_scheduled');

      return {
        userId,
        userEmail,
        activities: sumCells(userCells),
        leadsCreated: userLeads.length,
        qualified,
        qualificationRate: safeRate(qualified, userLeads.length),
        meetings,
      };
    })
    .filter((s) => s.activities > 0 || s.leadsCreated > 0)
    .sort((a, b) => b.activities - a.activities);
}

function buildSdrComparison(sdrTable: SdrPerformanceRow[]): SdrActivityComparisonEntry[] {
  return sdrTable.map((s) => ({
    userEmail: s.userEmail,
    activities: s.activities,
  }));
}

function buildDailySdrTrend(
  cells: InteractionCell[],
  memberLookup: Map<string, string>,
): { dailySdrTrend: DailySdrPerformanceEntry[]; dailySdrKeys: string[] } {
  // Count activities per SDR per day
  const sdrDayMap = new Map<string, Map<string, number>>();
  const sdrTotals = new Map<string, number>();

  for (const cell of cells) {
    if (!cell.performed_by) continue;
    const displayName = memberLookup.get(cell.performed_by);
    if (!displayName) continue;

    // Dia de Brasília (created_at − 3h), calculado no banco — o mesmo de
    // "Atividades por dia". Uma atividade às 22h BRT cai no dia certo.
    const dateStr = cell.day_brt;

    sdrTotals.set(displayName, (sdrTotals.get(displayName) ?? 0) + cell.n);

    if (!sdrDayMap.has(dateStr)) {
      sdrDayMap.set(dateStr, new Map());
    }
    const dayMap = sdrDayMap.get(dateStr)!;
    dayMap.set(displayName, (dayMap.get(displayName) ?? 0) + cell.n);
  }

  // Get top 5 SDRs by total activity
  const topSdrs = Array.from(sdrTotals.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([name]) => name);

  const dailySdrTrend: DailySdrPerformanceEntry[] = Array.from(sdrDayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayMap]) => {
      const dateParts = date.split('-');
      const entry: DailySdrPerformanceEntry = {
        date,
        label: dateParts[2] && dateParts[1] ? `${dateParts[2]}/${dateParts[1]}` : date,
      };
      for (const sdr of topSdrs) {
        entry[sdr] = dayMap.get(sdr) ?? 0;
      }
      return entry;
    });

  return { dailySdrTrend, dailySdrKeys: topSdrs };
}

function emptyData(): PerformanceAnalyticsData {
  return {
    totalActivities: 0,
    totalLeadsCreated: 0,
    totalQualified: 0,
    qualificationRate: 0,
    sdrTable: [],
    sdrComparison: [],
    dailySdrTrend: [],
    dailySdrKeys: [],
    dailyControl: [],
  };
}

function buildDailyControl(
  memberIds: string[],
  memberLookup: Map<string, string>,
  memberInfoLookup: Map<string, MemberInfo | undefined>,
  cellsByUser: Map<string, InteractionCell[]>,
  performers: Map<string | null, PerformerSummary>,
  leadsByAssignee: Map<string, LeadQueryRow[]>,
): DailyControlRow[] {
  return memberIds
    .map((userId) => {
      const userCells = cellsByUser.get(userId) ?? [];
      const userLeads = leadsByAssignee.get(userId) ?? [];
      const prospecting = userLeads.filter(
        (l) => l.status === 'contacted' || l.status === 'new',
      ).length;
      const available = userLeads.filter((l) => l.status === 'new').length;
      const won = userLeads.filter((l) => l.status === 'won').length;
      const lost = userLeads.filter((l) => l.status === 'unqualified').length;

      const total = sumCells(userCells);
      const completed = sumCells(userCells, (c) =>
        ['sent', 'delivered', 'meeting_scheduled'].includes(c.type),
      );
      const calls = sumCells(userCells, (c) => c.channel === 'phone');
      const emails = sumCells(userCells, (c) => c.channel === 'email');
      const research = sumCells(
        userCells,
        (c) => c.channel === 'research' || c.type === 'research',
      );

      // Última atividade = maior created_at do SDR (vem pronto do banco)
      const lastActivityAt = total > 0 ? performers.get(userId)?.lastAt : undefined;

      const info = memberInfoLookup.get(userId);

      return {
        userId,
        userName: memberLookup.get(userId) ?? userId.slice(0, 8),
        avatarUrl: info?.avatarUrl,
        lastActivityAt,
        prospecting,
        available,
        won,
        lost,
        pending: total - completed,
        completed,
        ignored: 0,
        calls,
        emails,
        research,
      };
    })
    .sort((a, b) => b.completed - a.completed);
}
