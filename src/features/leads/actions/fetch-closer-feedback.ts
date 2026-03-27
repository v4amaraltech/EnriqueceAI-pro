'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface CloserFeedbackData {
  id: string;
  result: 'meeting_done' | 'no_show' | 'rescheduled' | null;
  rating: number | null;
  comment: string | null;
  sent_at: string;
  responded_at: string | null;
  closer_name: string;
  closer_email: string;
}

const RESULT_LABELS: Record<string, string> = {
  meeting_done: 'Reunião realizada',
  no_show: 'Não compareceu',
  rescheduled: 'Remarcou',
};

export function getResultLabel(result: string): string {
  return RESULT_LABELS[result] ?? result;
}

export async function fetchCloserFeedback(leadId: string): Promise<ActionResult<CloserFeedbackData | null>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, error } = (await from(supabase, 'closer_feedback_requests')
    .select('id, result, rating, comment, sent_at, responded_at, closer_id')
    .eq('lead_id', leadId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: {
      id: string;
      result: 'meeting_done' | 'no_show' | 'rescheduled' | null;
      rating: number | null;
      comment: string | null;
      sent_at: string;
      responded_at: string | null;
      closer_id: string;
    } | null;
    error: unknown;
  };

  if (error) return { success: false, error: 'Erro ao buscar feedback' };
  if (!data) return { success: true, data: null };

  // Fetch closer name
  const { data: closer } = (await from(supabase, 'closers')
    .select('name, email')
    .eq('id', data.closer_id)
    .single()) as { data: { name: string; email: string } | null };

  return {
    success: true,
    data: {
      id: data.id,
      result: data.result,
      rating: data.rating,
      comment: data.comment,
      sent_at: data.sent_at,
      responded_at: data.responded_at,
      closer_name: closer?.name ?? 'Closer',
      closer_email: closer?.email ?? '',
    },
  };
}
