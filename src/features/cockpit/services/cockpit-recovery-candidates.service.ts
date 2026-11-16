import type { SupabaseClient } from '@supabase/supabase-js';

import { AUTO_DIAL_RULES } from '../utils/auto-dial-rules';
import { RECOVERY_BLOCKED_REASON_NAMES, RECOVERY_QUEUE_LIMIT } from '../utils/recovery-queue';
import type { CockpitViewer } from '../types';
import type { CockpitCandidateRow } from './cockpit-candidates.service';

interface RecoveryRpcRow {
  lead_id: string;
  lost_at: string;
  loss_reason_name: string | null;
  updated_at: string;
  calls_today: number;
  attempts_window: number;
  last_call_at: string | null;
  conversation_today: boolean;
  callback_pending: boolean;
  recovery_rank: number;
}

/**
 * Fila de recuperação, ordenada no banco (RPC `cockpit_recovery_candidates`, perda mais recente primeiro).
 * Só com cliente de service role, no servidor; `org_id` e o usuário vêm do viewer resolvido no servidor.
 * Devolve o MESMO formato dos candidatos da fila normal (`recovery_rank` entra como `coldRank`), para o servidor do motor
 * aplicar o mesmo portão. `null` em qualquer erro (falha fechada).
 */
export async function fetchRecoveryCandidates(
  client: SupabaseClient,
  input: { viewer: CockpitViewer; now: Date; excludeLeadIds?: string[]; limit?: number },
): Promise<CockpitCandidateRow[] | null> {
  try {
    const { data, error } = (await client.rpc('cockpit_recovery_candidates', {
      p_org_id: input.viewer.orgId,
      p_target_user_id: input.viewer.targetUserId,
      p_exclude_lead_ids: [...new Set(input.excludeLeadIds ?? [])],
      p_now: input.now.toISOString(),
      p_blocked_reason_names: [...RECOVERY_BLOCKED_REASON_NAMES],
      p_max_attempts_per_day: AUTO_DIAL_RULES.maxAttemptsPerDay,
      p_limit: input.limit ?? RECOVERY_QUEUE_LIMIT,
      // A função ainda não está em `types.ts` (só depois de aplicar a migration e rodar `pnpm gen:types`): mesmo cast do padrão.
    } as never)) as { data: RecoveryRpcRow[] | null; error: { message: string } | null };
    if (error) {
      console.error('[cockpit-auto-dial] cockpit_recovery_candidates:', error.message);
      return null;
    }
    return (data ?? []).map((r) => ({
      leadId: r.lead_id,
      updatedAt: r.updated_at,
      maybeHot: false,
      nextStepDue: null,
      attemptsRecent: 0,
      attemptsWindow: Number(r.attempts_window ?? 0),
      callsToday: Number(r.calls_today ?? 0),
      lastCallAt: r.last_call_at ?? null,
      overAttempts: false,
      coldRank: Number(r.recovery_rank),
    }));
  } catch (err) {
    console.error('[cockpit-auto-dial] cockpit_recovery_candidates:', err instanceof Error ? err.message : 'erro');
    return null;
  }
}
