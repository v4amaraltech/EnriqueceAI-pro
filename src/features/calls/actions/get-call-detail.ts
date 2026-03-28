'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { CallDetail, CallFeedbackRow, CallRow } from '../types';

const callIdSchema = z.string().uuid('ID inválido');

export async function getCallDetail(callId: string): Promise<ActionResult<CallDetail>> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: call, error } = (await from(supabase, 'calls')
    .select('*')
    .eq('id', callId)
    .single()) as { data: CallRow | null; error: { message: string } | null };

  if (error || !call) {
    return { success: false, error: 'Ligação não encontrada' };
  }

  const { data: feedback } = (await from(supabase, 'call_feedback')
    .select('*')
    .eq('call_id', callId)
    .order('created_at', { ascending: true })) as { data: CallFeedbackRow[] | null };

  return {
    success: true,
    data: {
      ...call,
      feedback: feedback ?? [],
    },
  };
}
