'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { LeadNote } from './add-lead-note';

const leadIdSchema = z.string().uuid('ID inválido');

export async function fetchLeadNotes(
  leadId: string,
): Promise<ActionResult<LeadNote[]>> {
  const parsed = leadIdSchema.safeParse(leadId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { data, error } = (await from(supabase, 'interactions')
    .select('id, message_content, metadata, created_at')
    .eq('lead_id', leadId)
    .contains('metadata', { is_note: true })
    .order('created_at', { ascending: false })
    .limit(50)) as {
      data: Array<{
        id: string;
        message_content: string | null;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }> | null;
      error: { message: string } | null;
    };

  if (error) {
    return { success: false, error: 'Erro ao buscar anotações' };
  }

  const notes: LeadNote[] = (data ?? []).map((row) => ({
    id: row.id,
    text: row.message_content ?? '',
    created_at: row.created_at,
    author_email: (row.metadata?.author as string) ?? null,
  }));

  return { success: true, data: notes };
}
