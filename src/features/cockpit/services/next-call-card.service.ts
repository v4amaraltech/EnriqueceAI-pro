import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { CockpitViewer, NextCallCardResult } from '../types';
import { suggestApproach } from '../utils/call-approach';
import { pickNextLead, type NextLeadCandidate } from '../utils/next-lead';
import { fetchCallContext, isCallCockpitEnabled } from './call-context.service';

const CANDIDATES_LIMIT = 15;
const INTERACTION_WINDOW_DAYS = 7;
const EXCLUDED_STATUSES = '(unqualified,archived)';

interface CandidateRow {
  id: string;
  updated_at: string;
  meeting_no_show_at: string | null;
  telefone: string | null;
}

/**
 * Cartão do próximo lead para ligar (PR03). SOMENTE LEITURA, nunca disca.
 *
 * Carteira: leads da organização em que o usuário exibido é `assigned_to` (SDR)
 * ou `closer_id` (closer). O contexto passa de novo por `fetchCallContext`, que
 * aplica a permissão do viewer (gestor lê a org; SDR e closer só a própria carteira).
 * Com a flag desligada nada além da flag é consultado.
 */
export async function fetchNextCallCard(input: {
  viewer: CockpitViewer;
  now?: Date;
  /** Leads já trabalhados nesta sessão (PR04). Resultado pendente nunca entra aqui. */
  excludeLeadIds?: string[];
}): Promise<NextCallCardResult> {
  if (!(await isCallCockpitEnabled())) return { status: 'disabled' };

  const { viewer } = input;
  const now = input.now ?? new Date();
  const target = viewer.targetUserId;
  const supabase = await createServerSupabaseClient();

  const leadsResult = (await from(supabase, 'leads')
    .select('id, updated_at, meeting_no_show_at, telefone')
    .eq('org_id', viewer.orgId)
    .is('deleted_at', null)
    .not('status', 'in', EXCLUDED_STATUSES)
    .not('telefone', 'is', null)
    .or(`assigned_to.eq.${target},closer_id.eq.${target}`)
    .order('updated_at', { ascending: false })
    .limit(CANDIDATES_LIMIT)) as { data: CandidateRow[] | null; error: { message: string } | null };

  if (leadsResult.error) {
    console.error('[next-call-card] leads:', leadsResult.error.message);
    return { status: 'error', error: 'Falha ao carregar a próxima ligação' };
  }

  const skipped = new Set(input.excludeLeadIds ?? []);
  const withPhone = (leadsResult.data ?? []).filter((l) => l.telefone?.trim() && !skipped.has(l.id));
  if (withPhone.length === 0) return { status: 'empty' };
  const ids = withPhone.map((l) => l.id);
  const since = new Date(now.getTime() - INTERACTION_WINDOW_DAYS * 86_400_000).toISOString();

  const [holdsResult, interactionsResult] = await Promise.all([
    from(supabase, 'contact_holds').select('lead_id').eq('org_id', viewer.orgId).eq('tipo', 'total').in('lead_id', ids) as unknown as Promise<{
      data: Array<{ lead_id: string }> | null;
      error: { message: string } | null;
    }>,
    from(supabase, 'interactions')
      .select('lead_id, type, created_at')
      .eq('org_id', viewer.orgId)
      .in('lead_id', ids)
      .in('type', ['replied', 'clicked', 'opened'])
      .gte('created_at', since) as unknown as Promise<{
      data: Array<{ lead_id: string; type: string; created_at: string }> | null;
      error: { message: string } | null;
    }>,
  ]);

  // Falha ao ler bloqueios: não arriscar ligar para quem pediu para parar.
  if (holdsResult.error) {
    console.error('[next-call-card] holds:', holdsResult.error.message);
    return { status: 'error', error: 'Falha ao verificar bloqueios de contato' };
  }
  if (interactionsResult.error) console.error('[next-call-card] interactions:', interactionsResult.error.message);

  const blocked = new Set((holdsResult.data ?? []).map((h) => h.lead_id));
  const candidates: NextLeadCandidate[] = withPhone
    .filter((l) => !blocked.has(l.id))
    .map((l) => ({ id: l.id, updatedAt: l.updated_at, noShowAt: l.meeting_no_show_at }));

  const leadId = pickNextLead({
    candidates,
    interactions: (interactionsResult.data ?? []).map((i) => ({ leadId: i.lead_id, type: i.type, at: i.created_at })),
    now,
  });
  if (!leadId) return { status: 'empty' };

  const context = await fetchCallContext({ viewer, leadId, now });
  if (context.status === 'error') return { status: 'error', error: context.error };
  if (context.status !== 'ok') return { status: context.status === 'disabled' ? 'disabled' : 'empty' };

  return { status: 'ok', data: { context: context.data, approach: suggestApproach(context.data), generatedAt: now.toISOString() } };
}
