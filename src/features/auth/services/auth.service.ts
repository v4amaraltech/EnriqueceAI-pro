import type { User } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { AuthContract } from '../auth.contract';
import type { MemberRole, OrganizationMemberRow, OrganizationRow } from '../types';

export async function createAuthService(): Promise<AuthContract> {
  const supabase = await createServerSupabaseClient();

  return {
    async getCurrentUser(): Promise<User | null> {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return user;
    },

    async getCurrentOrg(): Promise<OrganizationRow | null> {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = (await from(supabase, 'organization_members')
        .select('org_id, organizations(*)')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()) as { data: { organizations: OrganizationRow } | null };

      return data?.organizations ?? null;
    },

    async getMemberRole(): Promise<MemberRole | null> {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return null;

      const { data } = (await from(supabase, 'organization_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()) as { data: { role: string } | null };

      return (data?.role as MemberRole) ?? null;
    },

    async getOrgMembers(): Promise<OrganizationMemberRow[]> {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return [];

      const { data: member } = (await from(supabase, 'organization_members')
        .select('org_id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()) as { data: { org_id: string } | null };

      if (!member) return [];

      const { data } = (await from(supabase, 'organization_members')
        .select('*')
        .eq('org_id', member.org_id)) as { data: OrganizationMemberRow[] | null };

      return data ?? [];
    },

    async isManager(): Promise<boolean> {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return false;

      const { data } = (await from(supabase, 'organization_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()) as { data: { role: string } | null };

      return data?.role === 'manager';
    },
  };
}
