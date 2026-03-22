import { requireManager } from '@/lib/auth/require-manager';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { OrganizationSettings } from '@/features/auth/components/OrganizationSettings';
import type { MemberWithOrganization } from '@/features/auth/types';

export default async function CompanyGeneralPage() {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('*, organization:organizations(*)')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: MemberWithOrganization | null };

  if (!member?.organization) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Organização não encontrada.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <OrganizationSettings organization={member.organization} />
    </div>
  );
}
