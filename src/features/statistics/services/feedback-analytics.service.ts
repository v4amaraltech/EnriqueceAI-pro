import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { safeRate } from '../types/shared';
import type {
  FeedbackAnalyticsData,
  FeedbackKpis,
  FeedbackRow,
  CloserRankingEntry,
} from '../types/feedback-analytics.types';

interface RawFeedback {
  id: string;
  lead_id: string;
  closer_id: string;
  result: string | null;
  rating: number | null;
  comment: string | null;
  sent_at: string;
  responded_at: string | null;
  expires_at: string | null;
}

export async function fetchFeedbackAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  closerId?: string,
): Promise<FeedbackAnalyticsData> {
  // Fetch feedbacks
  let query = from(supabase, 'closer_feedback_requests')
    .select('id, lead_id, closer_id, result, rating, comment, sent_at, responded_at, expires_at')
    .eq('org_id', orgId)
    .gte('sent_at', periodStart)
    .lte('sent_at', periodEnd)
    .order('sent_at', { ascending: false })
    .limit(10000);

  if (closerId) {
    query = query.eq('closer_id', closerId);
  }

  const { data: rawFeedbacks } = (await query) as { data: RawFeedback[] | null };
  const feedbacks = rawFeedbacks ?? [];

  // Fetch closer names
  const closerIds = [...new Set(feedbacks.map((f) => f.closer_id))];
  let closerMap = new Map<string, string>();
  if (closerIds.length > 0) {
    const { data: closers } = (await from(supabase, 'closers')
      .select('id, name')
      .in('id', closerIds)) as { data: Array<{ id: string; name: string }> | null };
    closerMap = new Map((closers ?? []).map((c) => [c.id, c.name]));
  }

  // Fetch lead names
  const leadIds = [...new Set(feedbacks.map((f) => f.lead_id))];
  let leadMap = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = (await from(supabase, 'leads')
      .select('id, nome_fantasia, razao_social, first_name, last_name')
      .in('id', leadIds)
      .limit(10000)) as { data: Array<{ id: string; nome_fantasia: string | null; razao_social: string | null; first_name: string | null; last_name: string | null }> | null };
    leadMap = new Map(
      (leads ?? []).map((l) => [
        l.id,
        l.nome_fantasia ?? l.razao_social ?? [l.first_name, l.last_name].filter(Boolean).join(' ') ?? 'Lead',
      ]),
    );
  }

  const now = new Date();

  // Build feedback rows
  const feedbackRows: FeedbackRow[] = feedbacks.map((f) => {
    let status: FeedbackRow['status'] = 'pending';
    if (f.responded_at) {
      status = 'responded';
    } else if (f.expires_at && new Date(f.expires_at) < now) {
      status = 'expired';
    }

    return {
      id: f.id,
      leadId: f.lead_id,
      leadName: leadMap.get(f.lead_id) ?? 'Lead',
      closerId: f.closer_id,
      closerName: closerMap.get(f.closer_id) ?? 'Closer',
      result: f.result,
      rating: f.rating,
      comment: f.comment,
      sentAt: f.sent_at,
      respondedAt: f.responded_at,
      expiresAt: f.expires_at,
      status,
    };
  });

  // KPIs
  const responded = feedbackRows.filter((f) => f.status === 'responded');
  const ratings = responded.filter((f) => f.rating != null).map((f) => f.rating!);
  const responseTimes = responded
    .filter((f) => f.respondedAt)
    .map((f) => (new Date(f.respondedAt!).getTime() - new Date(f.sentAt).getTime()) / 3600000);

  const kpis: FeedbackKpis = {
    totalSent: feedbackRows.length,
    totalResponded: responded.length,
    responseRate: safeRate(responded.length, feedbackRows.length),
    averageRating: ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    averageResponseTimeHours: responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
    pendingCount: feedbackRows.filter((f) => f.status === 'pending').length,
  };

  // Closer ranking
  const closerGroups = new Map<string, FeedbackRow[]>();
  for (const f of feedbackRows) {
    const list = closerGroups.get(f.closerId) ?? [];
    list.push(f);
    closerGroups.set(f.closerId, list);
  }

  const closerRanking: CloserRankingEntry[] = [...closerGroups.entries()]
    .map(([cId, rows]) => {
      const respondedRows = rows.filter((r) => r.status === 'responded');
      const closerRatings = respondedRows.filter((r) => r.rating != null).map((r) => r.rating!);
      return {
        closerId: cId,
        closerName: closerMap.get(cId) ?? 'Closer',
        totalReceived: rows.length,
        totalResponded: respondedRows.length,
        responseRate: safeRate(respondedRows.length, rows.length),
        averageRating: closerRatings.length > 0 ? Math.round((closerRatings.reduce((a, b) => a + b, 0) / closerRatings.length) * 10) / 10 : null,
      };
    })
    .sort((a, b) => b.totalReceived - a.totalReceived);

  return { kpis, feedbacks: feedbackRows, closerRanking };
}
