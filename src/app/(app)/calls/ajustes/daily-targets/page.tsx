import { requireManager } from '@/lib/auth/require-manager';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { getCallSettings } from '@/features/calls/actions/call-settings-crud';
import { CallDailyTargets } from '@/features/calls/components/CallDailyTargets';

export default async function CallDailyTargetsPage() {
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
        <p className="text-sm text-destructive">Organização não encontrada.</p>
      </div>
    );
  }

  const orgId = currentMember.org_id;

  const [settingsResult, membersResult] = await Promise.all([
    getCallSettings(),
    supabase
      .from('organization_members')
      .select('user_id, role')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('created_at', { ascending: true }) as unknown as Promise<{
      data: Array<{ user_id: string; role: string }> | null;
    }>,
  ]);

  const members = membersResult.data ?? [];

  // Get display names via admin client
  const nameMap = new Map<string, string>();
  try {
    const adminClient = createAdminSupabaseClient();
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      const userIds = new Set(members.map((m) => m.user_id));
      for (const u of usersData.users) {
        if (userIds.has(u.id)) {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          nameMap.set(u.id, fullName || u.email?.split('@')[0] || u.id.slice(0, 8));
        }
      }
    }
  } catch {
    // Fallback
  }

  const memberInfos = members.map((m) => ({
    userId: m.user_id,
    name: nameMap.get(m.user_id) ?? m.user_id.slice(0, 8),
    role: m.role,
  }));

  const orgDefault = settingsResult.success
    ? (settingsResult.data.settings?.daily_call_target ?? 20)
    : 20;

  const dailyTargets = settingsResult.success ? settingsResult.data.dailyTargets : [];

  return (
    <CallDailyTargets
      orgDefault={orgDefault}
      members={memberInfos}
      initialTargets={dailyTargets}
    />
  );
}
