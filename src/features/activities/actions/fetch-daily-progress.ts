'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { isManager } from '@/lib/auth/require-manager';
import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';

import { GUARDRAIL_EVENTS, summarizeGuardrails, type DailyGuardrails } from '../utils/daily-guardrails';

export type { DailyGuardrails } from '../utils/daily-guardrails';

export interface DailyProgress {
  completed: number;
  pending: number;
  total: number;
  target: number;
  /** Escapes do dia (adiou / pulou / trocou / perdeu) — story activity-skip-guardrails. */
  guardrails: DailyGuardrails;
}

/**
 * Progresso diário do SDR. Sem argumento, é o do usuário logado; um manager pode
 * passar `sdrUserId` para ver o progresso de um SDR específico (o card segue o
 * filtro de SDR da tela de Atividades).
 *
 * `includePending: false` pula a conta de pendentes (4–5 consultas): a página de
 * Atividades descarta esse número e usa o tamanho da própria fila.
 */
export async function fetchDailyProgress(
  sdrUserId?: string,
  options: { includePending?: boolean } = {},
): Promise<ActionResult<DailyProgress>> {
  const includePending = options.includePending ?? true;
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Alvo da contagem: o próprio usuário, ou o SDR escolhido por um manager.
  let targetUserId = userId;
  if (sdrUserId && sdrUserId !== userId) {
    const manager = await isManager();
    if (!manager) {
      return { success: false, error: 'Apenas gestores podem ver o progresso de outro SDR', code: 'FORBIDDEN' };
    }
    targetUserId = sdrUserId;
  }

  // Count today's completed activities (interactions created today by this user)
  // BRT midnight: shift "now" by -3h then truncate to UTC midnight, shift back
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000);

  // Filter to channels the SDR actually performs. `system` covers automated
  // events (csv_import bulk-logs, soft-deletes, etc) that all carry the
  // SDR's user id in performed_by but aren't real activities — Rafael saw
  // 102 "atividades" today when 46 came from a single CSV import at 12:55
  // and 50 more were system events; only 6 were real (phone, whatsapp,
  // research). Keep only the user-driven channels so the daily target
  // reflects what the SDR actually did.
  const SDR_CHANNELS = ['email', 'whatsapp', 'phone', 'linkedin', 'research'];

  // The pieces below are independent — they used to run one after another
  // (up to 9 round trips in series). Now they run together.
  const [completed, guardrails, pending, target] = await Promise.all([
    countCompletedToday(),
    fetchGuardrails(),
    includePending ? countPending() : Promise.resolve(0),
    fetchTarget(),
  ]);

  return {
    success: true,
    data: {
      completed,
      pending,
      total: completed + pending,
      target,
      guardrails,
    },
  };

  async function countCompletedToday(): Promise<number> {
    // Além do canal, dois ruídos precisam sair da conta:
    //  - NOTAS (metadata.is_note=true): importações de CRM legado gravam notas nos
    //    leads com channel='research' e performed_by = dono do lead. Giovanni viu
    //    213 "feitas" num dia que fez 19 — 172 eram notas de uma carga do CRM. Nota
    //    (importada OU manual) é anotação, não atividade de cadência. `is.null` OR
    //    `neq.true` é null-safe: atividade real não tem a chave, então fica.
    //  - ENVIOS FALHOS (type='failed'): tentativa que não saiu não é toque
    //    concluído (eram 22 WhatsApp failed no mesmo dia).
    //  - E-MAILS DE CADÊNCIA AUTOMÁTICA (cadências type='auto_email'): são
    //    enviados pelo MOTOR (cron 8h-18h), não pelo SDR. Vinicius via "36 feitas"
    //    sem ter feito nada — 34 eram e-mails da "Inbound — E-mail (auto)". A meta
    //    é atividade MANUAL, então esses saem. E-mail manual (cadência standard)
    //    continua contando.
    //
    // Busca as candidatas (não head) para poder excluir as de cadência automática.
    // Também exclui os toques da RÉGUA de reunião (metadata.meeting_reminder=true):
    // são disparos automáticos gravados com performed_by=SDR (desde a régua entrar
    // no histórico do lead) — não são atividade manual. Os dois `.or` viram AND de
    // grupos OR no PostgREST (cada um null-safe).
    const [{ data: autoCadences }, { data: completedRows }] = await Promise.all([
      from(supabase, 'cadences').select('id').eq('org_id', orgId).eq('type', 'auto_email') as unknown as Promise<{
        data: Array<{ id: string }> | null;
      }>,
      from(supabase, 'interactions')
        .select('id, cadence_id')
        .eq('org_id', orgId)
        .eq('performed_by', targetUserId)
        .in('channel', SDR_CHANNELS)
        .neq('type', 'failed')
        .or('metadata->>is_note.is.null,metadata->>is_note.neq.true')
        .or('metadata->>meeting_reminder.is.null,metadata->>meeting_reminder.neq.true')
        .gte('created_at', todayStart.toISOString())
        .limit(5000) as unknown as Promise<{ data: Array<{ id: string; cadence_id: string | null }> | null }>,
    ]);
    const autoEmailCadenceIds = new Set((autoCadences ?? []).map((c) => c.id));
    return (completedRows ?? []).filter((r) => !r.cadence_id || !autoEmailCadenceIds.has(r.cadence_id)).length;
  }

  async function fetchGuardrails(): Promise<DailyGuardrails> {
    // Escapes do dia (adiou / pulou / trocou / perdeu). Eventos `system` do
    // próprio SDR — o gestor enxerga quem empurra tarefa em vez de executar.
    const { data: guardrailRows } = (await from(supabase, 'interactions')
      .select('metadata')
      .eq('org_id', orgId)
      .eq('performed_by', targetUserId)
      .eq('channel', 'system')
      .in('metadata->>system_event', [...GUARDRAIL_EVENTS])
      .gte('created_at', todayStart.toISOString())
      .limit(2000)) as { data: Array<{ metadata: Record<string, unknown> | null }> | null };
    return summarizeGuardrails(guardrailRows ?? []);
  }

  async function countPending(): Promise<number> {
    // Count pending activities for THIS SDR only:
    // Step 1: Get lead IDs assigned to this user
    const { data: myLeads } = (await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .eq('assigned_to', targetUserId)
      .is('deleted_at', null)
      .limit(1000)) as { data: Array<{ id: string }> | null };

    const myLeadIds = (myLeads ?? []).map((l) => l.id);
    if (myLeadIds.length === 0) return 0;

    // Step 2: Get active enrollments for MY leads only
    const nowIso = new Date().toISOString();
    const pendingEnrollments = await chunkedIn<{ id: string; cadence_id: string; lead_id: string; current_step: number }>(
      myLeadIds,
      (chunk) =>
        from(supabase, 'cadence_enrollments')
          .select('id, cadence_id, lead_id, current_step')
          .eq('status', 'active')
          .in('lead_id', chunk)
          .not('next_step_due', 'is', null)
          .lte('next_step_due', nowIso)
          .limit(500) as unknown as PromiseLike<{
          data: Array<{ id: string; cadence_id: string; lead_id: string; current_step: number }> | null;
          error: unknown;
        }>,
    );
    if (pendingEnrollments.length === 0) return 0;

    // Fetch matching steps to get step IDs for dedup
    const cadenceIds = [...new Set(pendingEnrollments.map((e) => e.cadence_id))];
    const { data: steps } = (await from(supabase, 'cadence_steps')
      .select('id, cadence_id, step_order')
      .in('cadence_id', cadenceIds)) as { data: Array<{ id: string; cadence_id: string; step_order: number }> | null };

    const stepMap = new Map<string, string>(); // "cadence_id:step_order" → step_id
    for (const s of steps ?? []) {
      stepMap.set(`${s.cadence_id}:${s.step_order}`, s.id);
    }

    // Build candidates with step IDs
    const candidates = pendingEnrollments
      .map((e) => ({
        cadenceId: e.cadence_id,
        stepId: stepMap.get(`${e.cadence_id}:${e.current_step}`),
        leadId: e.lead_id,
      }))
      .filter((c): c is { cadenceId: string; stepId: string; leadId: string } => !!c.stepId);
    if (candidates.length === 0) return 0;

    const stepIds = [...new Set(candidates.map((c) => c.stepId))];
    const leadIds = [...new Set(candidates.map((c) => c.leadId))];

    const existingInteractions = await chunkedIn<{ cadence_id: string; step_id: string; lead_id: string }>(
      leadIds,
      (chunk) =>
        from(supabase, 'interactions')
          .select('cadence_id, step_id, lead_id')
          .in('cadence_id', cadenceIds)
          .in('step_id', stepIds)
          .in('lead_id', chunk) as unknown as PromiseLike<{
          data: Array<{ cadence_id: string; step_id: string; lead_id: string }> | null;
          error: unknown;
        }>,
    );

    const executedSet = new Set(existingInteractions.map((i) => `${i.cadence_id}:${i.step_id}:${i.lead_id}`));
    return candidates.filter((c) => !executedSet.has(`${c.cadenceId}:${c.stepId}:${c.leadId}`)).length;
  }

  async function fetchTarget(): Promise<number> {
    // Daily goal: user-specific first, fallback to org default (user_id IS NULL).
    // Both rows are fetched together; the user's wins when it exists.
    const [{ data: userGoal }, { data: orgGoal }] = await Promise.all([
      from(supabase, 'daily_activity_goals')
        .select('target')
        .eq('org_id', orgId)
        .eq('user_id', targetUserId)
        .single() as unknown as Promise<{ data: { target: number } | null }>,
      from(supabase, 'daily_activity_goals')
        .select('target')
        .eq('org_id', orgId)
        .is('user_id', null)
        .single() as unknown as Promise<{ data: { target: number } | null }>,
    ]);
    return userGoal?.target ?? orgGoal?.target ?? 20; // default 20
  }
}
