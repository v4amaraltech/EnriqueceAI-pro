import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface MemberLimitResult {
  allowed: boolean;
  current: number;
  max: number;
}

export async function checkMemberLimit(
  supabase: SupabaseClient,
  orgId: string,
): Promise<MemberLimitResult> {
  // Get plan limits via subscription
  const { data: subscription } = (await from(supabase, 'subscriptions')
    .select('plan_id, plans(included_users)')
    .eq('org_id', orgId)
    .single()) as { data: { plan_id: string; plans: { included_users: number } } | null };

  const max = subscription?.plans?.included_users ?? 4;

  // Count active + invited members
  const { count } = (await from(supabase, 'organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', ['active', 'invited'])) as { count: number | null };

  const current = count ?? 0;

  return {
    allowed: current < max,
    current,
    max,
  };
}
