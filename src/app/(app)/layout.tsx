import { Suspense } from 'react';

import { ThemeProvider } from 'next-themes';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { OrganizationProvider } from '@/features/auth/components/OrganizationProvider';
import type { MemberWithOrganization, OrganizationMemberRow } from '@/features/auth/types';
import { SubscriptionGuard } from '@/features/billing/components/SubscriptionGuard';
import { TrialBanner } from '@/features/billing/components/TrialBanner';
import type { SubscriptionStatus } from '@/features/billing/types';
import { NotificationProvider } from '@/features/notifications/components/NotificationProvider';

import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import { ClientErrorBoundary } from '@/shared/components/ClientErrorBoundary';
import { PageSkeleton } from '@/shared/components/PageSkeleton';
import { fetchPendingActivitiesCount } from '@/features/activities/actions/fetch-pending-count';
import { TopBar } from '@/shared/components/TopBar';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';

import { Api4ComWebphoneWrapper } from '@/features/integrations/components/Api4ComWebphone';

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

  const [subscriptionResult, membersResult, namesResult, pendingCount] = await Promise.all([
    (from(supabase, 'subscriptions')
      .select('status, current_period_end')
      .eq('org_id', orgId)
      .maybeSingle() as unknown as Promise<{ data: { status: SubscriptionStatus; current_period_end: string } | null }>),

    (from(supabase, 'organization_members')
      .select('*')
      .eq('org_id', orgId) as unknown as Promise<{ data: OrganizationMemberRow[] | null }>),

    (async () => {
      const map = new Map<string, { name: string; avatar_url?: string }>();
      try {
        const adminClient = createAdminSupabaseClient();
        const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
        if (usersData?.users) {
          for (const u of usersData.users) {
            const meta = u.user_metadata as Record<string, unknown> | undefined;
            const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
            const avatarUrl = (meta?.avatar_url ?? '') as string;
            map.set(u.id, {
              name: fullName || u.email?.split('@')[0] || u.id.slice(0, 8),
              avatar_url: avatarUrl || undefined,
            });
          }
        }
      } catch {
        // Fallback: names will be undefined, consumers use user_id slice
      }
      return map;
    })(),

    fetchPendingActivitiesCount(),
  ]);

  const subscriptionData = subscriptionResult.data;
  const subscriptionStatus: SubscriptionStatus = subscriptionData?.status ?? 'active';
  const subscriptionPeriodEnd: string | null = subscriptionData?.current_period_end ?? null;
  const members = membersResult.data;
  const userInfoMap = namesResult;

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
                <main className="flex-1 overflow-auto p-6" data-tour="main-content">
                  <Breadcrumbs />
                  <Suspense fallback={<PageSkeleton />}>
                    {children}
                  </Suspense>
                </main>
              </div>
            </SubscriptionGuard>
            <Toaster />
            <ClientErrorBoundary>
              <Suspense fallback={null}>
                <Api4ComWebphoneWrapper />
              </Suspense>
            </ClientErrorBoundary>
          </NotificationProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
