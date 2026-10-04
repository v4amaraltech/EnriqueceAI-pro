import { Suspense } from 'react';

import { ThemeProvider } from 'next-themes';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { OrganizationProvider } from '@/features/auth/components/OrganizationProvider';
import type { MemberWithOrganization, OrganizationMemberRow } from '@/features/auth/types';
import { SubscriptionGuard } from '@/features/billing/components/SubscriptionGuard';
import { TrialBanner } from '@/features/billing/components/TrialBanner';
import type { SubscriptionStatus } from '@/features/billing/types';
import { BILLING_EXEMPT_PREFIXES, isSubscriptionBlocked } from '@/features/billing/utils/subscription-access';
import { NotificationProvider } from '@/features/notifications/components/NotificationProvider';

import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import { ChunkReloadFlagReset } from '@/shared/components/ChunkReloadFlagReset';
import { PageSkeleton } from '@/shared/components/PageSkeleton';
import { fetchPendingActivitiesCount } from '@/features/activities/actions/fetch-pending-count';
import { TopBar } from '@/shared/components/TopBar';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  let { data: memberData } = (await from(supabase, 'organization_members')
    .select('*, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: MemberWithOrganization | null };

  // Auto-activate invited members who logged in (clicked magic link)
  // Uses service role to bypass RLS (invited members can't read/update their own record)
  if (!memberData) {
    const serviceClient = createServiceRoleClient();
    const { data: invitedData } = (await from(serviceClient, 'organization_members')
      .select('*, organization:organizations(*)')
      .eq('user_id', user.id)
      .eq('status', 'invited')
      .single()) as { data: MemberWithOrganization | null };

    if (invitedData) {
      await from(serviceClient, 'organization_members')
        .update({ status: 'active', accepted_at: new Date().toISOString() })
        .eq('id', invitedData.id);
      memberData = { ...invitedData, status: 'active' };
    }
  }

  if (!memberData?.organization) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Organização não encontrada.</p>
      </div>
    );
  }

  // Redirect to onboarding if not yet completed
  if (memberData.organization.onboarding_step !== null && memberData.organization.onboarding_step !== undefined) {
    redirect('/onboarding');
  }
  // Fallback for orgs created before onboarding_step migration
  const orgName = memberData.organization.name;
  if (orgName && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(orgName)) {
    redirect('/onboarding');
  }

  // Fetch subscription, members and user names in parallel
  const orgId = memberData.organization.id;

  const [subscriptionResult, membersResult, pendingCount] = await Promise.all([
    (from(supabase, 'subscriptions')
      .select('status, current_period_end')
      .eq('org_id', orgId)
      .maybeSingle() as unknown as Promise<{ data: { status: SubscriptionStatus; current_period_end: string } | null }>),

    (from(supabase, 'organization_members')
      .select('*')
      .eq('org_id', orgId) as unknown as Promise<{ data: OrganizationMemberRow[] | null }>),

    fetchPendingActivitiesCount(),
  ]);

  const subscriptionData = subscriptionResult.data;
  const subscriptionStatus: SubscriptionStatus = subscriptionData?.status ?? 'active';
  const subscriptionPeriodEnd: string | null = subscriptionData?.current_period_end ?? null;
  const members = membersResult.data;

  // Server-side subscription gate (D4): blocks canceled / expired-trial / past_due
  // (after a 3-day grace) even with JS disabled or on direct navigation — the
  // client SubscriptionGuard below is just a snappier belt. /upgrade and
  // /settings/billing stay reachable (via x-pathname from the middleware) so the
  // user can still pay.
  const currentPathname = (await headers()).get('x-pathname') ?? '';
  if (
    isSubscriptionBlocked(subscriptionStatus, subscriptionPeriodEnd) &&
    !BILLING_EXEMPT_PREFIXES.some((p) => currentPathname.startsWith(p))
  ) {
    redirect('/upgrade');
  }

  // Member names/avatars from auth.users in one query (runs on every navigation)
  const profiles = await resolveUserProfiles((members ?? []).map((m) => m.user_id));
  const userInfoMap = new Map<string, { name: string; avatar_url?: string }>();
  for (const [id, p] of profiles) {
    userInfoMap.set(id, { name: p.displayName, avatar_url: p.avatarUrl ?? undefined });
  }

  const enrichedMembers = (members ?? []).map((m) => ({
    ...m,
    name: userInfoMap.get(m.user_id)?.name,
    avatar_url: userInfoMap.get(m.user_id)?.avatar_url,
  }));

  const currentMember: OrganizationMemberRow = {
    id: memberData.id,
    org_id: memberData.org_id,
    user_id: memberData.user_id,
    role: memberData.role,
    status: memberData.status,
    invited_at: memberData.invited_at,
    accepted_at: memberData.accepted_at,
    invited_expires_at: memberData.invited_expires_at ?? null,
    created_at: memberData.created_at,
    updated_at: memberData.updated_at,
    name: userInfoMap.get(memberData.user_id)?.name,
    avatar_url: userInfoMap.get(memberData.user_id)?.avatar_url,
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <OrganizationProvider
          initialOrg={memberData.organization}
          initialMembers={enrichedMembers}
          initialMember={currentMember}
        >
          <NotificationProvider userId={user.id}>
            <SubscriptionGuard status={subscriptionStatus} periodEnd={subscriptionPeriodEnd}>
              <div className="flex h-screen flex-col">
                {subscriptionStatus === 'trialing' && subscriptionPeriodEnd && (
                  <TrialBanner periodEnd={subscriptionPeriodEnd} />
                )}
                <TopBar pendingActivitiesCount={pendingCount} />
                <main className="flex-1 overflow-auto py-6" data-tour="main-content">
                  <div className="mx-auto max-w-[1600px] px-10">
                    <Breadcrumbs />
                    <Suspense fallback={<PageSkeleton />}>
                      {children}
                    </Suspense>
                  </div>
                </main>
              </div>
            </SubscriptionGuard>
            <Toaster />
            <ChunkReloadFlagReset />
          </NotificationProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
