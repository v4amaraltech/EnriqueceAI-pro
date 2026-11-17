import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { AUTO_DIAL_RULES } from '../utils/auto-dial-rules';
import { SIGNAL_CHUNK_SIZE, chunk } from '../utils/cold-lead-order';
import {
  RECOVERY_BLOCKED_REASON_NAMES,
  RECOVERY_QUEUE_LIMIT,
  isSemInteresseReason,
  semInteresseCooldownCutoff,
} from '../utils/recovery-queue';
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

export interface RecoveryHoldoutInput {
  leadId: string;
  lostAt: string;
  reasonName: string | null;
  /** Há retorno VENCIDO (explícito do SDR): ele vale mais que a quarentena e que o retorno futuro. */
  returnDue: boolean;
}

type Rows<T> = { data: T[] | null; error: { message: string } | null };

/** Teto de linhas por resposta do PostgREST (`max_rows`). Resposta com 1000 linhas exatas pode estar TRUNCADA: falha fechada. */
export const POSTGREST_MAX_ROWS = 1000;

/**
 * Leads que ficam FORA da recuperação por regra de TypeScript (a função SQL não muda):
 *  1) "Sem interesse" por 90 dias. A data de referência NÃO é só `leads.lost_at`: ela só é carimbada quando o lead ENTRA
 *     em perdido (trigger `set_qualified_at`), então trocar o motivo de quem já estava perdido não a move. Vale o que
 *     for mais recente entre `lost_at` e a última interação `lead_lost` (a ação de desqualificar grava uma a cada
 *     troca). `updated_at` não serve: muda por qualquer edição (48% dos "Sem interesse" antigos têm update recente).
 *  2) Retorno FUTURO agendado (`scheduled_activities` pendente, telefone, `kind='return'`, `scheduled_at` > agora): o SQL
 *     só enxerga retorno vencido; sem isto o motor ligaria hoje para quem pediu "ligue em 2027".
 * Retorno vencido (`returnDue`) dispensa as duas regras. `null` = falha de leitura (falha fechada).
 */
export async function loadRecoveryHoldoutLeadIds(
  client: SupabaseClient,
  orgId: string,
  leads: RecoveryHoldoutInput[],
  now: Date,
): Promise<Set<string> | null> {
  const out = new Set<string>();
  const subject = leads.filter((l) => !l.returnDue);
  if (subject.length === 0) return out;
  const cutoff = semInteresseCooldownCutoff(now);

  // 1) Sem interesse: perda recente ou troca de motivo recente (interação `lead_lost`) = quarentena.
  const old: string[] = [];
  for (const l of subject) {
    if (!isSemInteresseReason(l.reasonName)) continue;
    const lostAt = Date.parse(l.lostAt);
    if (Number.isNaN(lostAt) || lostAt >= cutoff.getTime()) out.add(l.leadId);
    else old.push(l.leadId);
  }
  for (const part of chunk(old, SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'interactions')
      .select('lead_id, metadata')
      .eq('org_id', orgId)
      .eq('channel', 'system')
      .eq('metadata->>system_event', 'lead_lost') // filtrado NO BANCO: só as trocas de motivo, não todas as interações system
      .in('lead_id', part)
      .gte('created_at', cutoff.toISOString())) as Rows<{ lead_id: string; metadata: { system_event?: string } | null }>;
    if (error || !data || data.length >= POSTGREST_MAX_ROWS) return null; // teto = possivelmente truncada
    for (const r of data) if (r.metadata?.system_event === 'lead_lost') out.add(r.lead_id);
  }

  // 2) Retorno futuro pendente.
  for (const part of chunk(subject.map((l) => l.leadId), SIGNAL_CHUNK_SIZE)) {
    const { data, error } = (await from(client, 'scheduled_activities')
      .select('lead_id')
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .eq('channel', 'phone')
      .eq('kind', 'return')
      .in('lead_id', part)
      .gt('scheduled_at', now.toISOString())) as Rows<{ lead_id: string }>;
    if (error || !data || data.length >= POSTGREST_MAX_ROWS) return null;
    for (const r of data) out.add(r.lead_id);
  }
  return out;
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
    })) as { data: RecoveryRpcRow[] | null; error: { message: string } | null };
    if (error) {
      console.error('[cockpit-auto-dial] cockpit_recovery_candidates:', error.message);
      return null;
    }
    const rows = data ?? [];
    // "Sem interesse" em quarentena e retorno futuro ficam fora (ver `loadRecoveryHoldoutLeadIds`); erro = fila indisponível.
    const holdout = await loadRecoveryHoldoutLeadIds(
      client,
      input.viewer.orgId,
      rows.map((r) => ({ leadId: r.lead_id, lostAt: r.lost_at, reasonName: r.loss_reason_name, returnDue: Boolean(r.callback_pending) })),
      input.now,
    );
    if (!holdout) return null;
    return rows.filter((r) => !holdout.has(r.lead_id)).map((r) => ({
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
