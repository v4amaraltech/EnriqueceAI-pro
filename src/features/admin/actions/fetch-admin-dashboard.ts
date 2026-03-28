'use server';

import { requireAdmin } from '@/lib/auth/require-admin';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type { AdminDashboardData, AdminOrgRow } from '../types';

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  await requireAdmin();

  const supabase = createServiceRoleClient();

  const [orgsResult, leadsAgg, membersAgg, trialsResult] = await Promise.all([
    from(supabase, 'organizations')
      .select('id, name, created_at, subscriptions(status, plan_id, plans(name))')
      .order('created_at', { ascending: false }),

    from(supabase, 'leads').select('org_id', { count: 'exact', head: false }),

    from(supabase, 'organization_members')
      .select('org_id')
      .eq('status', 'active'),

    from(supabase, 'subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'trialing'),
  ]);

  // Build leads count map: org_id → count
  const leadsCountMap = new Map<string, number>();
  if (leadsAgg.data) {
    for (const row of leadsAgg.data) {
      const orgId = row.org_id as string;
      leadsCountMap.set(orgId, (leadsCountMap.get(orgId) ?? 0) + 1);
    }
  }

  // Build members count map: org_id → count
  const membersCountMap = new Map<string, number>();
  if (membersAgg.data) {
    for (const row of membersAgg.data) {
      const orgId = row.org_id as string;
      membersCountMap.set(orgId, (membersCountMap.get(orgId) ?? 0) + 1);
    }
  }

  const orgs = (orgsResult.data ?? []) as Array<{ id: string; name: string; created_at: string; subscriptions: unknown }>;
  const organizations: AdminOrgRow[] = orgs.map((org) => {
    // subscriptions is an array from the join
    const subs = org.subscriptions as Array<{
      status: string;
      plan_id: string;
      plans: { name: string } | null;
    }> | null;
    const sub = subs?.[0];

    return {
      id: org.id,
      name: org.name,
      created_at: org.created_at,
      members_count: membersCountMap.get(org.id) ?? 0,
      leads_count: leadsCountMap.get(org.id) ?? 0,
      plan_name: sub?.plans?.name ?? null,
      subscription_status: sub?.status ?? null,
    };
  });

  let totalMembers = 0;
  for (const count of membersCountMap.values()) {
    totalMembers += count;
  }

  let totalLeads = 0;
  for (const count of leadsCountMap.values()) {
    totalLeads += count;
  }

  return {
    metrics: {
      totalOrgs: organizations.length,
      totalMembers,
      totalLeads,
      activeTrials: trialsResult.count ?? 0,
    },
    organizations,
  };
}
