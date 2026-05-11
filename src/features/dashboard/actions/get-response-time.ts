'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';

import type { InteractionQueryRow, LeadQueryRow } from '@/features/statistics/types/query-rows';

import type { DashboardResponseTimeData, ResponseTimeByUser } from '../types';

function parseTimeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Convert a UTC date to BRT (UTC-3) hours/minutes/day-of-week */
function toBRT(date: Date): { hours: number; minutes: number; dayOfWeek: number } {
  const brt = new Date(date.getTime() - 3 * 60 * 60 * 1000);
  return { hours: brt.getUTCHours(), minutes: brt.getUTCMinutes(), dayOfWeek: brt.getUTCDay() };
}

export interface ResponseTimeFilters {
  cadenceFocus?: string[];
  days?: number[];
  timeFrom?: string;
  timeTo?: string;
}

export async function getResponseTimeData(
  thresholdMinutes: number = 30,
  dateRange?: { from: string; to: string },
  filters?: ResponseTimeFilters,
): Promise<ActionResult<DashboardResponseTimeData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId } = auth.data;
  const supabase = createServiceRoleClient();

  const now = new Date();
  // Use BRT (UTC-3) for date boundaries so "2026-04-01" means midnight BRT, not UTC
  const monthStart = dateRange?.from
    ? `${dateRange.from}T03:00:00Z`
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 3)).toISOString();
  const monthEnd = dateRange?.to
    ? `${dateRange.to}T23:59:59-03:00`
    : now.toISOString();

  // Fetch leads created in period
  const { data: leads } = (await from(supabase, 'leads')
    .select('id, created_at, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .gte('created_at', monthStart)
    .lte('created_at', monthEnd)) as { data: LeadQueryRow[] | null };

  if (!leads?.length) {
    return { success: true, data: { thresholdMinutes, overallPct: 0, totalLeads: 0, byUser: [] } };
  }

  // Apply in-memory filters on leads
  let filteredLeads = leads;

  if (filters?.days && filters.days.length < 7) {
    const daySet = new Set(filters.days);
    filteredLeads = filteredLeads.filter((l) => daySet.has(toBRT(new Date(l.created_at)).dayOfWeek));
  }

  if (filters?.timeFrom || filters?.timeTo) {
    const fromMin = parseTimeToMinutes(filters.timeFrom ?? '00:00');
    const toMin = parseTimeToMinutes(filters.timeTo ?? '23:59');
    filteredLeads = filteredLeads.filter((l) => {
      const brt = toBRT(new Date(l.created_at));
      const leadMin = brt.hours * 60 + brt.minutes;
      return leadMin >= fromMin && leadMin <= toMin;
    });
  }

  if (filters?.cadenceFocus && filters.cadenceFocus.length > 0 && filters.cadenceFocus.length < 3) {
    const allLeadIds = filteredLeads.map((l) => l.id);
    if (allLeadIds.length > 0) {
      // cadence_enrollments has no org_id — lead_id already scoped by org via filteredLeads
      const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
        .select('lead_id, cadence_id')
        .in('lead_id', allLeadIds)) as { data: { lead_id: string; cadence_id: string }[] | null };

      if (enrollments?.length) {
        const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
        const { data: cadences } = (await from(supabase, 'cadences')
          .select('id, origin')
          .in('id', cadenceIds)) as { data: { id: string; origin: string }[] | null };

        const focusSet = new Set(filters.cadenceFocus);
        const matchingCadenceIds = new Set(
          (cadences ?? []).filter((c) => focusSet.has(c.origin)).map((c) => c.id),
        );
        const matchingLeadIds = new Set(
          enrollments.filter((e) => matchingCadenceIds.has(e.cadence_id)).map((e) => e.lead_id),
        );
        filteredLeads = filteredLeads.filter((l) => matchingLeadIds.has(l.id));
      } else {
        filteredLeads = [];
      }
    }
  }

  if (!filteredLeads.length) {
    return { success: true, data: { thresholdMinutes, overallPct: 0, totalLeads: 0, byUser: [] } };
  }

  const leadIds = filteredLeads.map((l) => l.id);

  // Fetch first interaction per lead (sent or delivered).
  // We chunk the .in() because PostgREST's URL is a hard ceiling around 4-8KB:
  // a single .in() with ~200 UUIDs already approaches that. Without chunking,
  // the request silently returned no rows for orgs with many leads/month and
  // the whole "em até 30 min" column collapsed to 0%.
  const INTERACTIONS_CHUNK = 200;
  const firstInteractionMap = new Map<string, string>();
  for (let i = 0; i < leadIds.length; i += INTERACTIONS_CHUNK) {
    const chunk = leadIds.slice(i, i + INTERACTIONS_CHUNK);
    const { data: interactions } = (await from(supabase, 'interactions')
      .select('lead_id, created_at')
      .eq('org_id', orgId)
      .in('lead_id', chunk)
      .in('type', ['sent', 'delivered'])
      .order('created_at', { ascending: true })) as { data: InteractionQueryRow[] | null };
    for (const it of interactions ?? []) {
      const existing = firstInteractionMap.get(it.lead_id);
      if (!existing || it.created_at < existing) {
        firstInteractionMap.set(it.lead_id, it.created_at);
      }
    }
  }

  // Get SDRs (exclude managers from response time metrics)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Calculate per-user breakdown
  const userMap = new Map<string, { total: number; within: number }>();
  let overallWithin = 0;
  let overallTotal = 0;

  for (const lead of filteredLeads) {
    const userId = lead.assigned_to;
    if (!userId) continue;
    if (!sdrIds.has(userId)) continue; // Exclude managers

    overallTotal++;
    const entry = userMap.get(userId) ?? { total: 0, within: 0 };
    entry.total++;

    const firstAt = firstInteractionMap.get(lead.id);
    if (firstAt) {
      const diffMs = new Date(firstAt).getTime() - new Date(lead.created_at).getTime();
      const diffMin = diffMs / (1000 * 60);
      if (diffMin <= thresholdMinutes) {
        entry.within++;
        overallWithin++;
      }
    }

    userMap.set(userId, entry);
  }

  // Resolve user names
  const nameMap = new Map<string, { name: string; avatarUrl: string | null }>();
  try {
    const admin = createAdminSupabaseClient();
    const userIdsToResolve = [...userMap.keys()];
    await Promise.all(
      userIdsToResolve.map(async (id) => {
        const { data } = await admin.auth.admin.getUserById(id);
        if (data?.user) {
          const u = data.user;
          const name = (u.user_metadata?.name as string) || (u.user_metadata?.full_name as string) || u.email?.split('@')[0] || u.id.slice(0, 8);
          const avatarUrl = (u.user_metadata?.avatar_url as string) || (u.user_metadata?.picture as string) || null;
          nameMap.set(u.id, { name, avatarUrl });
        }
      }),
    );
  } catch { /* fallback to truncated IDs */ }

  const byUser: ResponseTimeByUser[] = Array.from(userMap.entries())
    .map(([userId, { total, within }]) => ({
      userId,
      userName: nameMap.get(userId)?.name ?? userId.slice(0, 8),
      avatarUrl: nameMap.get(userId)?.avatarUrl ?? null,
      leadsApproached: total,
      withinThreshold: within,
      withinThresholdPct: total > 0 ? Math.round((within / total) * 100) : 0,
    }))
    .sort((a, b) => b.leadsApproached - a.leadsApproached);

  return {
    success: true,
    data: {
      thresholdMinutes,
      overallPct: overallTotal > 0 ? Math.round((overallWithin / overallTotal) * 100) : 0,
      totalLeads: overallTotal,
      byUser,
    },
  };
}
