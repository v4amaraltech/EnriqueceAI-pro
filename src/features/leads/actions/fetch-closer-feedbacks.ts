'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

export interface CloserFeedbackRow {
  id: string;
  lead_name: string;
  closer_name: string;
  closer_email: string;
  result: string | null;
  rating: number | null;
  comment: string | null;
  sent_at: string;
  responded_at: string | null;
  expires_at: string;
}

export async function fetchCloserFeedbacks(
  dateFrom?: string,
  dateTo?: string,
): Promise<ActionResult<CloserFeedbackRow[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  let query = from(supabase, 'closer_feedback_requests')
    .select('id, result, rating, comment, sent_at, responded_at, expires_at, lead_id, closer_id')
    .eq('org_id', orgId)
    .order('sent_at', { ascending: false })
    .limit(200);

  if (dateFrom) query = query.gte('sent_at', new Date(dateFrom).toISOString());
  if (dateTo) query = query.lte('sent_at', new Date(dateTo + 'T23:59:59').toISOString());

  const { data, error } = (await query) as {
    data: Array<{
      id: string;
      result: string | null;
      rating: number | null;
      comment: string | null;
      sent_at: string;
      responded_at: string | null;
      expires_at: string;
      lead_id: string;
      closer_id: string;
    }> | null;
    error: unknown;
  };

  if (error || !data) return { success: false, error: 'Erro ao buscar feedbacks' };

  // Batch fetch lead names and closer names
  const leadIds = [...new Set(data.map((d) => d.lead_id))];
  const closerIds = [...new Set(data.map((d) => d.closer_id))];

  const [leadsResult, closersResult] = await Promise.all([
    from(supabase, 'leads')
      .select('id, nome_fantasia, razao_social')
      .in('id', leadIds) as Promise<{ data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null }> | null }>,
    from(supabase, 'closers')
      .select('id, name, email')
      .in('id', closerIds) as Promise<{ data: Array<{ id: string; name: string; email: string }> | null }>,
  ]);

  const leadMap = new Map((leadsResult.data ?? []).map((l) => [l.id, l.nome_fantasia ?? l.razao_social ?? 'Lead']));
  const closerMap = new Map((closersResult.data ?? []).map((c) => [c.id, { name: c.name, email: c.email }]));

  return {
    success: true,
    data: data.map((d) => ({
      id: d.id,
      lead_name: leadMap.get(d.lead_id) ?? 'Lead',
      closer_name: closerMap.get(d.closer_id)?.name ?? 'Closer',
      closer_email: closerMap.get(d.closer_id)?.email ?? '',
      result: d.result,
      rating: d.rating,
      comment: d.comment,
      sent_at: d.sent_at,
      responded_at: d.responded_at,
      expires_at: d.expires_at,
    })),
  };
}
