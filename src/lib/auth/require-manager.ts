import { redirect } from 'next/navigation';

import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { requireAuth } from './require-auth';

export async function requireManager() {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await from(supabase, 'organization_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { role: string } | null };

  if (member?.role !== 'manager') redirect('/dashboard');
  return user;
}
