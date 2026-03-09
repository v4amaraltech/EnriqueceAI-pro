'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

export interface WhatsAppTemplateOption {
  id: string;
  name: string;
  body: string;
}

export async function fetchWhatsAppTemplates(): Promise<ActionResult<WhatsAppTemplateOption[]>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, error } = (await from(supabase, 'message_templates')
    .select('id, name, body')
    .eq('org_id', member.org_id)
    .eq('channel', 'whatsapp')
    .order('name')) as { data: WhatsAppTemplateOption[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar templates' };
  }

  return { success: true, data: data ?? [] };
}
