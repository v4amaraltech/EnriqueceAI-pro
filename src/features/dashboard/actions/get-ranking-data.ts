'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { fetchRankingData } from '../services/ranking-metrics.service';
import type { DashboardFilters, RankingData, SdrRankingEntry } from '../types';

const filtersSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM format'),
  cadenceIds: z.array(z.string().uuid()).default([]),
  userIds: z.array(z.string().uuid()).default([]),
});

export async function getRankingData(
  rawFilters: DashboardFilters,
): Promise<ActionResult<RankingData>> {
  const { userId, orgId, role } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const parsed = filtersSchema.safeParse(rawFilters);
  if (!parsed.success) {
    return { success: false, error: 'Filtros inválidos' };
  }

  const filters = parsed.data;

  // SDR isolation: force ranking to show only their own data
  if (role === 'sdr') {
    filters.userIds = [userId];
  }

  try {
    const ranking = await fetchRankingData(supabase, orgId, filters);

    // Resolve user IDs to display names
    const allUserIds = new Set<string>();
    for (const card of [ranking.leadsFinished, ranking.activitiesDone, ranking.conversionRate]) {
      for (const entry of card.sdrBreakdown) {
        allUserIds.add(entry.userId);
      }
    }

    const userNameMap = new Map<string, string>();
    const userAvatarMap = new Map<string, string>();
    if (allUserIds.size > 0) {
      try {
        const adminClient = createAdminSupabaseClient();
        const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
        if (usersData?.users) {
          for (const u of usersData.users) {
            if (allUserIds.has(u.id)) {
              const meta = u.user_metadata as { full_name?: string; avatar_url?: string } | undefined;
              const name = meta?.full_name ?? u.email?.split('@')[0] ?? u.id.slice(0, 8);
              userNameMap.set(u.id, name);
              if (meta?.avatar_url) {
                userAvatarMap.set(u.id, meta.avatar_url);
              }
            }
          }
        }
      } catch {
        // Fallback: keep userId truncated
      }
    }

    function resolveNames(entries: SdrRankingEntry[]): SdrRankingEntry[] {
      return entries.map((e) => ({
        ...e,
        userName: userNameMap.get(e.userId) ?? e.userId.slice(0, 8),
        avatarUrl: userAvatarMap.get(e.userId),
      }));
    }

    ranking.leadsFinished.sdrBreakdown = resolveNames(ranking.leadsFinished.sdrBreakdown);
    ranking.activitiesDone.sdrBreakdown = resolveNames(ranking.activitiesDone.sdrBreakdown);
    ranking.conversionRate.sdrBreakdown = resolveNames(ranking.conversionRate.sdrBreakdown);

    return { success: true, data: ranking };
  } catch {
    return { success: false, error: 'Erro ao buscar dados de ranking' };
  }
}
