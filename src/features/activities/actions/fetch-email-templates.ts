'use server';

import { isAutoEmailTemplate } from '@/features/templates/internal-templates';
import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface EmailTemplateOption {
  id: string;
  name: string;
  subject: string | null;
  body: string;
}

/**
 * Lista de templates para o SDR escolher ao executar uma tarefa de e-mail.
 * Esconde os templates internos da cadência automática ("Auto Email - Step N"),
 * exceto o template da própria etapa (`keepTemplateId`), que sempre aparece.
 */
export async function fetchEmailTemplates(
  keepTemplateId?: string | null,
): Promise<ActionResult<EmailTemplateOption[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'message_templates')
    .select('id, name, subject, body')
    .eq('org_id', orgId)
    .eq('channel', 'email')
    .order('name')) as { data: EmailTemplateOption[] | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao buscar templates' };
  }

  const visible = (data ?? []).filter(
    (t) => t.id === keepTemplateId || !isAutoEmailTemplate(t.name),
  );

  return { success: true, data: visible };
}
