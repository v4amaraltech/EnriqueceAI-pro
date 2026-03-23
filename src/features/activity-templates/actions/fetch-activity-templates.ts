'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuthWithMember } from '@/lib/auth/require-auth-with-member';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { ActivityTemplateRow } from '../types';

export async function fetchActivityTemplates(): Promise<ActionResult<ActivityTemplateRow[]>> {
  const { orgId } = await requireAuthWithMember();
  const supabase = await createServerSupabaseClient();

  const { data, error } = (await from(supabase, 'activity_templates')
    .select('*')
    .eq('org_id', orgId)
    .order('name')) as { data: ActivityTemplateRow[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao carregar templates de atividades' };
  }

  return { success: true, data: data ?? [] };
}
