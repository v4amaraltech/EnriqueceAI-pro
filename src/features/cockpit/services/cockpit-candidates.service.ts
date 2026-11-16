import type { SupabaseClient } from '@supabase/supabase-js';

import { buildCandidatesRpcArgs, type CandidatesRpcOverrides } from '../utils/cold-lead-order';
import type { CockpitViewer } from '../types';

export interface CockpitCandidateRow {
  leadId: string;
  updatedAt: string;
  maybeHot: boolean;
  nextStepDue: string | null;
  attemptsRecent: number;
  attemptsWindow: number;
  callsToday: number;
  lastCallAt: string | null;
  overAttempts: boolean;
  /** null = fora da ordem do frio (ex.: teto diário atingido). */
  coldRank: number | null;
}

interface RpcRow {
  lead_id: string;
  updated_at: string;
  maybe_hot: boolean;
  next_step_due: string | null;
  attempts_recent: number;
  attempts_window: number;
  calls_today: number;
  last_call_at: string | null;
  over_attempts: boolean;
  cold_rank: number | null;
}

/**
 * Candidatos do Cockpit ordenados no banco (RPC `cockpit_next_call_candidates`).
 * Só com cliente de service role, no servidor. `null` em qualquer erro: o chamador volta à escolha anterior.
 */
export async function fetchCockpitCandidates(
  client: SupabaseClient,
  input: { viewer: CockpitViewer; now: Date; excludeLeadIds?: string[]; overrides?: CandidatesRpcOverrides },
): Promise<CockpitCandidateRow[] | null> {
  try {
    const { data, error } = (await client.rpc(
      'cockpit_next_call_candidates',
      buildCandidatesRpcArgs(input.viewer, input.now, input.excludeLeadIds ?? [], input.overrides),
    )) as { data: RpcRow[] | null; error: { message: string } | null };
    if (error) {
      console.error('[next-call-card] cockpit_next_call_candidates:', error.message);
      return null;
    }
    return (data ?? []).map((r) => ({
      leadId: r.lead_id,
      updatedAt: r.updated_at,
      maybeHot: r.maybe_hot === true,
      nextStepDue: r.next_step_due ?? null,
      attemptsRecent: Number(r.attempts_recent ?? 0),
      attemptsWindow: Number(r.attempts_window ?? 0),
      callsToday: Number(r.calls_today ?? 0),
      lastCallAt: r.last_call_at ?? null,
      overAttempts: r.over_attempts === true,
      coldRank: r.cold_rank == null ? null : Number(r.cold_rank),
    }));
  } catch (err) {
    console.error('[next-call-card] cockpit_next_call_candidates:', err instanceof Error ? err.message : 'erro');
    return null;
  }
}
