import { Suspense } from 'react';

import { ThemeProvider } from 'next-themes';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { OrganizationProvider } from '@/features/auth/components/OrganizationProvider';
import type { MemberWithOrganization, OrganizationMemberRow } from '@/features/auth/types';
import { SubscriptionGuard } from '@/features/billing/components/SubscriptionGuard';
import { TrialBanner } from '@/features/billing/components/TrialBanner';
import type { SubscriptionStatus } from '@/features/billing/types';
import { NotificationProvider } from '@/features/notifications/components/NotificationProvider';

import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import { ClientErrorBoundary } from '@/shared/components/ClientErrorBoundary';
import { PageSkeleton } from '@/shared/components/PageSkeleton';
import { TopBar } from '@/shared/components/TopBar';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';

import { Api4ComWebphoneWrapper } from '@/features/integrations/components/Api4ComWebphone';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  let { data: memberData } = (await supabase
    .from('organization_members')
    .select('*, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: MemberWithOrganization | null };

  // Auto-activate invited members who logged in (clicked magic link)
  if (!memberData) {
    const { data: invitedData } = (await supabase
      .from('organization_members')
      .select('*, organization:organizations(*)')
      .eq('user_id', user.id)
      .eq('status', 'invited')
      .single()) as { data: MemberWithOrganization | null };

    if (invitedData) {
      await supabase
        .from('organization_members')
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

  // Fetch subscription status for canceled guard
  const { data: subscriptionData } = (await from(supabase, 'subscriptions')
    .select('status, current_period_end')
    .eq('org_id', memberData.organization.id)
    .maybeSingle()) as { data: { status: SubscriptionStatus; current_period_end: string } | null };

  const subscriptionStatus: SubscriptionStatus = subscriptionData?.status ?? 'active';
  const subscriptionPeriodEnd: string | null = subscriptionData?.current_period_end ?? null;

  const { data: members } = (await supabase
    .from('organization_members')
    .select('*')
    .eq('org_id', memberData.organization.id)) as { data: OrganizationMemberRow[] | null };

  // Enrich members with user names from auth.users
  const nameMap = new Map<string, string>();
  try {
    const adminClient = createAdminSupabaseClient();
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        const meta = u.user_metadata as Record<string, unknown> | undefined;
        const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
        nameMap.set(u.id, fullName || u.email?.split('@')[0] || u.id.slice(0, 8));
      }
    }
  } catch {
    // Fallback: names will be undefined, consumers use user_id slice
  }

  const enrichedMembers = (members ?? []).map((m) => ({
    ...m,
    name: nameMap.get(m.user_id),
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
    name: nameMap.get(memberData.user_id),
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
                <TopBar />
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
  } catch (error) {
    // NEXT_REDIRECT must be re-thrown
    if (error instanceof Error && 'digest' in error && typeof (error as { digest: unknown }).digest === 'string' && ((error as { digest: string }).digest).startsWith('NEXT_REDIRECT')) {
      throw error;
    }
    console.error('[AppLayout] LAYOUT_CRASH:', error);
    console.error('[AppLayout] LAYOUT_CRASH_STACK:', error instanceof Error ? error.stack : 'no stack');
    throw error;
  }
}
