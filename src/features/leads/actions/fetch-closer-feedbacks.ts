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

// A feedback request gets killed when a manager reassigns the lead's closer:
// reassignCloser sets the old request's `expires_at = now()` (well before its
// natural 7-day window) and creates a fresh request for the new closer. The
// killed request lingers as an unanswered "Expirado" row next to the real one,
// polluting both the list and the closer response-rate metrics. We hide those
// superseded requests from the reporting view (data is untouched).
const NATURAL_WINDOW_FLOOR_MS = 6 * 24 * 60 * 60 * 1000; // 6 days (natural window is 7)

function isSupersededByReassignment(
  row: { responded_at: string | null; sent_at: string; expires_at: string; lead_id: string },
  newestSentByLead: Map<string, number>,
): boolean {
  if (row.responded_at) return false; // answered requests always count
  const sentMs = new Date(row.sent_at).getTime();
  const expiresMs = new Date(row.expires_at).getTime();
  // Killed early (short validity window) → reassignment, not a natural 7-day expiry.
  if (expiresMs - sentMs >= NATURAL_WINDOW_FLOOR_MS) return false;
  // A later request exists for the same lead = the replacement that superseded it.
  return (newestSentByLead.get(row.lead_id) ?? -Infinity) > sentMs;
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

  if (dateFrom) query = query.gte('sent_at', `${dateFrom}T03:00:00Z`);
  if (dateTo) query = query.lte('sent_at', `${dateTo}T23:59:59-03:00`);

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

  // Drop requests that were superseded by a closer reassignment so they don't
  // show up as phantom "Expirado" rows or drag down response-rate metrics.
  const newestSentByLead = new Map<string, number>();
  for (const d of data) {
    const ms = new Date(d.sent_at).getTime();
    const current = newestSentByLead.get(d.lead_id);
    if (current === undefined || ms > current) newestSentByLead.set(d.lead_id, ms);
  }
  const visible = data.filter((d) => !isSupersededByReassignment(d, newestSentByLead));

  // Batch fetch lead names and closer names
  const leadIds = [...new Set(visible.map((d) => d.lead_id))];
  const closerIds = [...new Set(visible.map((d) => d.closer_id))];

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
    data: visible.map((d) => ({
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
