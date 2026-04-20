'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CallDetail, CallFeedbackRow, CallRow } from '../types';

const callIdSchema = z.string().uuid('ID inválido');

export async function getCallDetail(callId: string): Promise<ActionResult<CallDetail>> {
  const parsed = callIdSchema.safeParse(callId);
  if (!parsed.success) return { success: false, error: 'ID inválido' };

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data: callWithFeedback, error } = (await from(supabase, 'calls')
    .select('*, call_feedback(*)')
    .eq('id', callId)
    .eq('org_id', orgId)
    .single()) as { data: (CallRow & { call_feedback: CallFeedbackRow[] }) | null; error: { message: string } | null };

  if (error || !callWithFeedback) {
    return { success: false, error: 'Ligação não encontrada' };
  }

  const { call_feedback, ...call } = callWithFeedback;

  return {
    success: true,
    data: {
      ...call,
      feedback: call_feedback ?? [],
    },
  };
}
