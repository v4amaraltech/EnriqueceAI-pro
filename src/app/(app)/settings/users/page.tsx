import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { UserManagement } from '@/features/auth/components/UserManagement';
import { checkMemberLimit } from '@/features/auth/services/member-limits.service';
import type { OrganizationMemberRow } from '@/features/auth/types';

export default async function UsersPage() {
  const user = await requireManager();
  const supabase = await createServerSupabaseClient();

  // Get current user's org
  const { data: currentMember } = (await from(supabase, 'organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!currentMember) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Organização não encontrada.</p>
      </div>
    );
  }

  // Expire stale invites on-demand (invited_expires_at < now)
  await from(supabase, 'organization_members')
    .update({ status: 'removed' })
    .eq('org_id', currentMember.org_id)
    .eq('status', 'invited')
    .lt('invited_expires_at', new Date().toISOString());

  const { data: members } = (await from(supabase, 'organization_members')
    .select('*')
    .eq('org_id', currentMember.org_id)
    .in('status', ['active', 'invited', 'suspended'])
    .order('created_at', { ascending: true })) as { data: OrganizationMemberRow[] | null };

  const { data: org } = (await from(supabase, 'organizations')
    .select('owner_id')
    .eq('id', currentMember.org_id)
    .single()) as { data: { owner_id: string } | null };

  const limit = await checkMemberLimit(supabase, currentMember.org_id);

  // Resolve user names from auth.users
  const adminClient = createAdminSupabaseClient();
  const nameMap: Record<string, string> = {};
  for (const m of members ?? []) {
    try {
      const { data } = await adminClient.auth.admin.getUserById(m.user_id);
      const meta = data?.user?.user_metadata as { full_name?: string } | undefined;
      const email = data?.user?.email;
      nameMap[m.user_id] = meta?.full_name || email || m.user_id;
    } catch {
      nameMap[m.user_id] = m.user_id;
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-6 text-2xl font-bold">Gestão de Usuários</h1>
      <UserManagement
        members={members ?? []}
        ownerId={org?.owner_id ?? ''}
        currentUserId={user.id}
        memberCount={limit.current}
        memberMax={limit.max}
        nameMap={nameMap}
      />
    </div>
  );
}
