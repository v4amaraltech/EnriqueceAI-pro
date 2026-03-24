'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface LeadNote {
  id: string;
  text: string;
  created_at: string;
  author_email: string | null;
}

export async function addLeadNote(
  leadId: string,
  text: string,
): Promise<ActionResult<LeadNote>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  if (!text.trim()) {
    return { success: false, error: 'A anotação não pode estar vazia' };
  }

  // Fetch user email for note authorship
  const { data: { user } } = await supabase.auth.getUser();
  const authorEmail = user?.email ?? null;

  const { data: interaction, error } = (await from(supabase, 'interactions')
    .insert({
      org_id: orgId,
      lead_id: leadId,
      cadence_id: null,
      step_id: null,
      channel: 'research',
      type: 'sent',
      message_content: text.trim(),
      metadata: { is_note: true, author: authorEmail },
      ai_generated: false,
      original_template_id: null,
    } as Record<string, unknown>)
    .select('id, created_at')
    .single()) as { data: { id: string; created_at: string } | null; error: { message: string } | null };

  if (error || !interaction) {
    return { success: false, error: 'Erro ao salvar anotação' };
  }

  revalidatePath(`/leads/${leadId}`);

  return {
    success: true,
    data: {
      id: interaction.id,
      text: text.trim(),
      created_at: interaction.created_at,
      author_email: authorEmail,
    },
  };
}
