import type { SupabaseClient } from '@supabase/supabase-js';

import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import { latestSaoByLead, type SaoFeedbackRow } from '../utils/latest-sao-by-lead';

/**
 * SAO por lead (`true` = closer aceitou a oportunidade, `false` = não aceitou)
 * para um conjunto de leads. Lê `closer_feedback_requests` em chunks (a lista
 * de reuniões realizadas de um mês passa fácil de 200 ids — `.in()` grande
 * estoura a URL do PostgREST) e resolve a resposta mais recente por lead.
 *
 * Fonte única do SAO no Dashboard: o KPI grande e o ranking por SDR usam esta
 * função — se a regra mudar, muda aqui (e em `latestSaoByLead`).
 */
export async function fetchSaoByLead(
  supabase: SupabaseClient,
  orgId: string,
  leadIds: readonly string[],
): Promise<Map<string, boolean>> {
  if (leadIds.length === 0) return new Map();

  const rows = await chunkedIn<SaoFeedbackRow>(leadIds, (chunk) =>
    from(supabase, 'closer_feedback_requests')
      .select('lead_id, oportunidade_qualificada, responded_at')
      .eq('org_id', orgId)
      .not('responded_at', 'is', null)
      .not('oportunidade_qualificada', 'is', null)
      .in('lead_id', chunk) as unknown as PromiseLike<{
      data: SaoFeedbackRow[] | null;
      error: unknown;
    }>,
  );

  return latestSaoByLead(rows);
}
