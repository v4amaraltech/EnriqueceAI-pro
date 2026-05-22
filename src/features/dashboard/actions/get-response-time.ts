'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { chunkedIn } from '@/lib/supabase/chunked-in';
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

  // Fetch leads created in period. Archived leads excluded — they were
  // discarded by the SDR/manager and shouldn't drag the response-time
  // denominator down.
  const { data: leads } = (await from(supabase, 'leads')
    .select('id, created_at, assigned_to')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'archived')
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
      const enrollments = await chunkedIn<{ lead_id: string; cadence_id: string }>(allLeadIds, (chunk) =>
        from(supabase, 'cadence_enrollments')
          .select('lead_id, cadence_id')
          .in('lead_id', chunk) as unknown as PromiseLike<{
          data: { lead_id: string; cadence_id: string }[] | null;
          error: unknown;
        }>,
      );

      if (enrollments.length) {
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

  // Fetch first HUMAN interaction per lead (channels phone/whatsapp/email/
  // linkedin/research, types sent/delivered).
  //
  // Excluding channel='system'/'calendar'/'crm' is critical: when a lead is
  // created (CSV import, inbound API, manual) the system inserts a
  // {channel:'system', type:'sent'} log row in the same instant. Without the
  // channel filter that row was treated as "first contact" and the
  // AUTOMATION_GRACE_SECONDS heuristic then dropped 95% of leads (1,690 of
  // 1,782 in V4 Amaral May/2026 audit) from the denominator — the card
  // collapsed onto the ~5% residual and showed an inflated ~99% within-30min.
  //
  // Chunked via chunkedIn to avoid PostgREST's ~4-8KB URL ceiling.
  const interactions = await chunkedIn<InteractionQueryRow>(leadIds, (chunk) =>
    from(supabase, 'interactions')
      .select('lead_id, created_at')
      .eq('org_id', orgId)
      .in('lead_id', chunk)
      .in('type', ['sent', 'delivered'])
      .in('channel', ['phone', 'whatsapp', 'email', 'linkedin', 'research'])
      .order('created_at', { ascending: true }) as unknown as PromiseLike<{
      data: InteractionQueryRow[] | null;
      error: unknown;
    }>,
  );
  const firstInteractionMap = new Map<string, string>();
  for (const it of interactions) {
    const existing = firstInteractionMap.get(it.lead_id);
    if (!existing || it.created_at < existing) {
      firstInteractionMap.set(it.lead_id, it.created_at);
    }
  }

  // Get SDRs (exclude managers from response time metrics)
  const { data: sdrs } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'sdr')
    .in('status', ['active', 'invited'])) as { data: Array<{ user_id: string }> | null };
  const sdrIds = new Set((sdrs ?? []).map((s) => s.user_id));

  // Calculate per-user breakdown.
  //
  // Two filters keep this metric honest:
  //  1) Leads with NO first interaction are excluded from the denominator —
  //     they're "not yet contacted", not "contacted slowly". Otherwise SDRs
  //     who got assigned a lot of fresh leads look slow.
  //  2) Defense-in-depth: interactions registered <5s after the lead row was
  //     created are dropped even after the channel filter, in case some new
  //     automation surfaces on a human-looking channel (e.g. CRM mirroring
  //     a webhook into channel='email' synchronously). Without the channel
  //     filter alone this guard was masking the actual response time — see
  //     audit 2026-05-22.
  const AUTOMATION_GRACE_SECONDS = 5;
  const userMap = new Map<string, { total: number; within: number }>();
  let overallWithin = 0;
  let overallTotal = 0;

  for (const lead of filteredLeads) {
    const userId = lead.assigned_to;
    if (!userId) continue;
    if (!sdrIds.has(userId)) continue; // Exclude managers

    const firstAt = firstInteractionMap.get(lead.id);
    if (!firstAt) continue; // Lead not yet contacted — exclude from denominator

    const diffMs = new Date(firstAt).getTime() - new Date(lead.created_at).getTime();
    const diffSec = diffMs / 1000;
    if (diffSec < AUTOMATION_GRACE_SECONDS) continue; // Looks like inbound automation, not a human reply

    overallTotal++;
    const entry = userMap.get(userId) ?? { total: 0, within: 0 };
    entry.total++;

    const diffMin = diffSec / 60;
    if (diffMin <= thresholdMinutes) {
      entry.within++;
      overallWithin++;
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
