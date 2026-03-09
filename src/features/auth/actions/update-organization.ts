'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireManager } from '@/lib/auth/require-manager';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { updateOrganizationSchema } from '../schemas/organization.schemas';
import type { OrganizationRow } from '../types';

export async function updateOrganization(
  formData: FormData,
): Promise<ActionResult<OrganizationRow>> {
  await requireManager();

  const raw = { name: formData.get('name') };
  const parsed = updateOrganizationSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', (await supabase.auth.getUser()).data.user!.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const query = from(supabase, 'organizations');
  const { data, error } = (await query
    .update({ name: parsed.data.name, updated_at: new Date().toISOString() })
    .eq('id', member.org_id)
    .select()
    .single()) as { data: OrganizationRow | null; error: { message: string; code?: string } | null };

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  revalidatePath('/settings');
  return { success: true, data: data! };
}
