import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';
import { safeRate } from '../types/shared';
import type {
  FeedbackAnalyticsData,
  FeedbackKpis,
  FeedbackRow,
  CloserRankingEntry,
} from '../types/feedback-analytics.types';
import { readAllRows } from './read-all-rows';

interface RawFeedback {
  id: string;
  lead_id: string;
  closer_id: string;
  result: string | null;
  rating: number | null;
  oportunidade_qualificada: boolean | null;
  comment: string | null;
  sent_at: string;
  responded_at: string | null;
  expires_at: string | null;
}

/**
 * Taxa de SAO: qualificadas ÷ feedbacks em que o closer respondeu a pergunta.
 * Quem não respondeu (histórico anterior ao campo, no-show, remarcada) fica
 * fora do denominador em vez de contar como "não qualificada".
 */
function saoStats(rows: FeedbackRow[]): { answered: number; qualified: number; rate: number | null } {
  const answered = rows.filter((f) => f.oportunidadeQualificada !== null);
  const qualified = answered.filter((f) => f.oportunidadeQualificada).length;
  return {
    answered: answered.length,
    qualified,
    rate: answered.length > 0 ? safeRate(qualified, answered.length) : null,
  };
}

export async function fetchFeedbackAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  closerId?: string,
): Promise<FeedbackAnalyticsData> {
  // Fetch feedbacks — paginado (antes `.limit(10000)`, set/2026).
  const feedbacks = await readAllRows<RawFeedback>('feedback: pedidos', () => {
    let query = from(supabase, 'closer_feedback_requests')
      .select('id, lead_id, closer_id, result, rating, oportunidade_qualificada, comment, sent_at, responded_at, expires_at')
      .eq('org_id', orgId)
      .gte('sent_at', periodStart)
      .lte('sent_at', periodEnd);
    if (isUuid(closerId)) query = query.eq('closer_id', closerId);
    return query.order('sent_at', { ascending: false }).order('id', { ascending: false });
  });

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
    const leads = await chunkedIn<{
      id: string;
      nome_fantasia: string | null;
      razao_social: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(leadIds, (chunk) =>
      from(supabase, 'leads')
        .select('id, nome_fantasia, razao_social, first_name, last_name')
        .in('id', chunk) as unknown as PromiseLike<{
        data: Array<{
          id: string;
          nome_fantasia: string | null;
          razao_social: string | null;
          first_name: string | null;
          last_name: string | null;
        }> | null;
        error: unknown;
      }>,
    );
    leadMap = new Map(
      leads.map((l) => [
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
      oportunidadeQualificada: f.oportunidade_qualificada,
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

  const globalSao = saoStats(responded);

  const kpis: FeedbackKpis = {
    totalSent: feedbackRows.length,
    totalResponded: responded.length,
    responseRate: safeRate(responded.length, feedbackRows.length),
    averageRating: ratings.length > 0 ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
    averageResponseTimeHours: responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
    pendingCount: feedbackRows.filter((f) => f.status === 'pending').length,
    saoRate: globalSao.rate,
    saoAnswered: globalSao.answered,
    saoQualified: globalSao.qualified,
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
      const closerSao = saoStats(respondedRows);
      return {
        closerId: cId,
        closerName: closerMap.get(cId) ?? 'Closer',
        totalReceived: rows.length,
        totalResponded: respondedRows.length,
        responseRate: safeRate(respondedRows.length, rows.length),
        averageRating: closerRatings.length > 0 ? Math.round((closerRatings.reduce((a, b) => a + b, 0) / closerRatings.length) * 10) / 10 : null,
        saoRate: closerSao.rate,
        saoAnswered: closerSao.answered,
      };
    })
    .sort((a, b) => b.totalReceived - a.totalReceived);

  return { kpis, feedbacks: feedbackRows, closerRanking };
}
