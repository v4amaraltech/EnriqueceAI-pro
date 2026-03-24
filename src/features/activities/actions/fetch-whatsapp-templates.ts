'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface WhatsAppTemplateOption {
  id: string;
  name: string;
  body: string;
}

export async function fetchWhatsAppTemplates(): Promise<ActionResult<WhatsAppTemplateOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'message_templates')
    .select('id, name, body')
    .eq('org_id', orgId)
    .eq('channel', 'whatsapp')
    .order('name')) as { data: WhatsAppTemplateOption[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar templates' };
  }

  return { success: true, data: data ?? [] };
}
