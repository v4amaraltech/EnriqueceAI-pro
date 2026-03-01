import { Suspense } from 'react';

import { ThemeProvider } from 'next-themes';

import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { OrganizationProvider } from '@/features/auth/components/OrganizationProvider';
import type { MemberWithOrganization, OrganizationMemberRow } from '@/features/auth/types';
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
            <div className="flex h-screen flex-col">
              <TopBar />
              <main className="flex-1 overflow-auto p-6" data-tour="main-content">
                <Breadcrumbs />
                <Suspense fallback={<PageSkeleton />}>
                  {children}
                </Suspense>
              </main>
            </div>
            <Toaster />
          </NotificationProvider>
        </OrganizationProvider>
      </TooltipProvider>
    </ThemeProvider>
  );
}
