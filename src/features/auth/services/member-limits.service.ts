import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { isUnlimited } from '@/lib/utils/plan-limits';

export interface MemberLimitResult {
  allowed: boolean;
  current: number;
  max: number;
}

export async function checkMemberLimit(
  supabase: SupabaseClient,
  orgId: string,
): Promise<MemberLimitResult> {
  const [subscriptionResult, organizationResult, memberCountResult] = await Promise.all([
    from(supabase, 'subscriptions')
      .select('plan_id, plans(included_users)')
      .eq('org_id', orgId)
      .single() as unknown as Promise<{
      data: { plan_id: string; plans: { included_users: number } } | null;
    }>,
    from(supabase, 'organizations')
      .select('member_limit_override')
      .eq('id', orgId)
      .single() as unknown as Promise<{
      data: { member_limit_override: number | null } | null;
    }>,
    from(supabase, 'organization_members')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .in('status', ['active', 'invited']) as unknown as Promise<{ count: number | null }>,
  ]);

  const override = organizationResult.data?.member_limit_override ?? null;
  const planLimit = subscriptionResult.data?.plans?.included_users ?? 4;
  const max = override ?? planLimit;
  const current = memberCountResult.count ?? 0;

  return {
    allowed: isUnlimited(max) || current < max,
    current,
    max,
  };
}
