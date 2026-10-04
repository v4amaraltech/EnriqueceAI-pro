import { requireManager } from '@/lib/auth/require-manager';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { TeamRosterView } from '@/features/auth/components/TeamRosterView';
import type { OrganizationMemberRow } from '@/features/auth/types';

export default async function CompanyTeamsPage() {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  const { data: currentMember } = (await from(supabase, 'organization_members')
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

  const { data: members } = (await from(supabase, 'organization_members')
    .select('*')
    .eq('org_id', currentMember.org_id)
    .in('status', ['active', 'invited', 'suspended'])
    .order('created_at', { ascending: true })) as {
    data: OrganizationMemberRow[] | null;
  };

  // Names from auth.users in one query (was one sequential call per member)
  const profiles = await resolveUserProfiles((members ?? []).map((m) => m.user_id));
  const nameMap: Record<string, string> = {};
  for (const m of members ?? []) {
    const p = profiles.get(m.user_id);
    nameMap[m.user_id] = p?.fullName || p?.email || m.user_id;
  }

  return <TeamRosterView members={members ?? []} nameMap={nameMap} />;
}
