'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
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
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  if (!text.trim()) {
    return { success: false, error: 'A anotação não pode estar vazia' };
  }

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const authorEmail = user.email ?? null;

  const { data: interaction, error } = (await from(supabase, 'interactions')
    .insert({
      org_id: member.org_id,
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
