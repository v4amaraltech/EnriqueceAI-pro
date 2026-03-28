import { redirect } from 'next/navigation';

import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { requireAuth } from './require-auth';

export type MemberRole = 'manager' | 'sdr';

export interface AuthWithMember {
  userId: string;
  orgId: string;
  role: MemberRole;
}

export async function requireAuthWithMember(): Promise<AuthWithMember> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('org_id, role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string; role: MemberRole } | null };

  if (!member) redirect('/login');

  return { userId: user.id, orgId: member.org_id, role: member.role };
}
