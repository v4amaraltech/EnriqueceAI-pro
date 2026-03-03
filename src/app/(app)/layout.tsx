import { Suspense } from 'react';

import { ThemeProvider } from 'next-themes';
import { redirect } from 'next/navigation';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { OrganizationProvider } from '@/features/auth/components/OrganizationProvider';
import type { MemberWithOrganization, OrganizationMemberRow } from '@/features/auth/types';
import { SubscriptionGuard } from '@/features/billing/components/SubscriptionGuard';
import { TrialBanner } from '@/features/billing/components/TrialBanner';
import type { SubscriptionStatus } from '@/features/billing/types';
import { NotificationProvider } from '@/features/notifications/components/NotificationProvider';

import { Breadcrumbs } from '@/shared/components/Breadcrumbs';
import { PageSkeleton } from '@/shared/components/PageSkeleton';
import { TopBar } from '@/shared/components/TopBar';
import { Toaster } from '@/shared/components/ui/sonner';
import { TooltipProvider } from '@/shared/components/ui/tooltip';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: memberData } = (await supabase
    .from('organization_members')
    .select('*, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: MemberWithOrganization | null };

  if (!memberData?.organization) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Organização não encontrada.</p>
      </div>
    );
  }

  // Redirect to onboarding if org name looks like a domain (not yet configured)
  const orgName = memberData.organization.name;
  if (orgName && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(orgName)) {
    redirect('/onboarding');
  }

  // Fetch subscription status for trial banner and canceled guard
  const { data: subscriptionData } = (await (
    supabase.from('subscriptions') as ReturnType<typeof supabase.from>
  )
    .select('status, current_period_end')
    .eq('org_id', memberData.organization.id)
    .maybeSingle()) as { data: { status: SubscriptionStatus; current_period_end: string } | null };

  const subscriptionStatus: SubscriptionStatus = subscriptionData?.status ?? 'trialing';
  const trialDaysRemaining = (() => {
    if (subscriptionStatus !== 'trialing' || !subscriptionData?.current_period_end) return null;
    const end = new Date(subscriptionData.current_period_end).getTime();
    const now = new Date().getTime();
    return Math.max(0, Math.ceil((end - now) / (1000 * 60 * 60 * 24)));
  })();

  const { data: members } = (await supabase
    .from('organization_members')
    .select('*')
    .eq('org_id', memberData.organization.id)) as { data: OrganizationMemberRow[] | null };

  const currentMember: OrganizationMemberRow = {
    id: memberData.id,
    org_id: memberData.org_id,
    user_id: memberData.user_id,
    role: memberData.role,
    status: memberData.status,
    invited_at: memberData.invited_at,
    accepted_at: memberData.accepted_at,
    created_at: memberData.created_at,
    updated_at: memberData.updated_at,
  };

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <OrganizationProvider
          initialOrg={memberData.organization}
          initialMembers={members ?? []}
          initialMember={currentMember}
        >
          <NotificationProvider userId={user.id}>
            <SubscriptionGuard status={subscriptionStatus}>
              <div className="flex h-screen flex-col">
                <TopBar />
                {trialDaysRemaining !== null && trialDaysRemaining > 0 && (
                  <TrialBanner daysRemaining={trialDaysRemaining} />
                )}
                <main className="flex-1 overflow-auto p-6" data-tour="main-content">
                  <Breadcrumbs />
                  <Suspense fallback={<PageSkeleton />}>
                    {children}
                  </Suspense>
                </main>
              </div>
            </SubscriptionGuard>
            <Toaster />
          </NotificationProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
