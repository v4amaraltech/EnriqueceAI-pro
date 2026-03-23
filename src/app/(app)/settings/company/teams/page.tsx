import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { TeamRosterView } from '@/features/auth/components/TeamRosterView';
import type { OrganizationMemberRow } from '@/features/auth/types';

export default async function CompanyTeamsPage() {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: currentMember } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!currentMember) {
    return (
      <div className="p-4">
        <p className="text-sm text-[var(--muted-foreground)]">
          Organização não encontrada.
        </p>
      </div>
    );
  }

  const { data: members } = (await supabase
    .from('organization_members')
    .select('*')
    .eq('org_id', currentMember.org_id)
    .in('status', ['active', 'invited', 'suspended'])
    .order('created_at', { ascending: true })) as {
    data: OrganizationMemberRow[] | null;
  };

  const adminClient = createAdminSupabaseClient();
  const nameMap: Record<string, string> = {};
  for (const m of members ?? []) {
    try {
      const { data } = await adminClient.auth.admin.getUserById(m.user_id);
      const meta = data?.user?.user_metadata as
        | { full_name?: string }
        | undefined;
      const email = data?.user?.email;
      nameMap[m.user_id] = meta?.full_name || email || m.user_id;
    } catch {
      nameMap[m.user_id] = m.user_id;
    }
  }

  return <TeamRosterView members={members ?? []} nameMap={nameMap} />;
}
