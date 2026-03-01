import { getCallSettings } from '@/features/calls/actions/call-settings-crud';
import { CallSettingsView } from '@/features/calls/components/CallSettingsView';
import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function CallSettingsPage() {
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
      <div className="p-6">
        <p className="text-[var(--destructive)]">Organização não encontrada.</p>
      </div>
    );
  }

  const orgId = currentMember.org_id;

  // Fetch settings data
  const settingsResult = await getCallSettings();

  if (!settingsResult.success) {
    return (
      <div className="p-6">
        <p className="text-[var(--destructive)]">Erro: {settingsResult.error}</p>
      </div>
    );
  }

  // Fetch active members for the daily targets table
  const { data: members } = (await supabase
    .from('organization_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })) as {
    data: Array<{ user_id: string; role: string }> | null;
  };

  // Get display names via admin client
  const nameMap = new Map<string, string>();
  try {
    const adminClient = createAdminSupabaseClient();
    const userIds = members?.map((m) => m.user_id) ?? [];
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        if (userIds.includes(u.id)) {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          const email = u.email ?? '';
          nameMap.set(u.id, fullName || email);
        }
      }
    }
  } catch {
    // Fallback: if service_role key is missing
  }

  const memberInfos = (members ?? []).map((m) => {
    return {
      userId: m.user_id,
      name: nameMap.get(m.user_id) ?? m.user_id.slice(0, 8),
      role: m.role,
    };
  });

  return (
    <div className="mx-auto max-w-3xl p-6">
      <CallSettingsView
        settings={settingsResult.data.settings}
        dailyTargets={settingsResult.data.dailyTargets}
        blacklist={settingsResult.data.blacklist}
        members={memberInfos}
      />
    </div>
  );
}
