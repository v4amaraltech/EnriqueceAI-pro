'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';

import { scheduleInboundRecovery } from '@/features/leads/services/inbound-recovery.service';

/**
 * Daily job that expires cadence_enrollments whose lead has been inactive
 * longer than the cadence's auto_loss_after_days threshold. Marks the lead
 * 'unqualified', the enrollment 'completed', and stamps the cadence's
 * auto_loss_reason_id on the enrollment so loss-reason charts attribute it
 * correctly.
 *
 * Inactivity = days since the most recent interaction on the lead, falling
 * back to enrolled_at when the lead has never had any interactions logged.
 *
 * Duas origens de candidato (RPC chamado com p_include_completed => true):
 * - 'active': enrollment em andamento — comportamento histórico do job.
 * - 'completed': o lead TERMINOU a cadência e ficou 'contacted' sem cadência
 *   nenhuma. Antes esses leads nunca eram avaliados (o RPC só olhava
 *   'active'), então o prazo da cadência parava junto com ela e o lead ficava
 *   em limbo para sempre. Ver docs/stories/cadence-end-auto-loss.story.md.
 */
interface CandidateRow {
  enrollment_id: string;
  lead_id: string;
  org_id: string;
  cadence_id: string;
  auto_loss_reason_id: string;
  auto_loss_after_days: number;
  inactive_days: number;
  enrollment_status: 'active' | 'completed';
}

/**
 * Teto por org e por execução para os candidatos vindos de cadência concluída.
 *
 * Sem ele o passivo acumulado sai todo de uma vez: na V4 Amaral, 64 leads
 * vencem no mesmo dia e os 64 são inbound, ou seja, iriam para a Recovery
 * juntos com a mesma data de início — a onda que em 04/set precisou ser
 * espalhada na mão. Com o teto a fila drena em alguns dias, sozinha.
 *
 * Candidatos de enrollment ativo NÃO são limitados: o comportamento que já
 * existia continua igual.
 */
const MAX_COMPLETED_CANDIDATES_PER_ORG_PER_RUN = 25;

export async function expireInactiveLeads(): Promise<ActionResult<{
  cadences_scanned: number;
  enrollments_expired: number;
  leads_lost: number;
}>> {
  const supabase = createServiceRoleClient();

  // Fetch eligible cadences first so we can report scanned count even when
  // there are zero stale enrollments.
  const { data: cadences, error: cadenceError } = (await from(supabase, 'cadences')
    .select('id')
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('auto_loss_after_days', 'is', null)
    .not('auto_loss_reason_id', 'is', null)) as {
    data: { id: string }[] | null;
    error: { message: string } | null;
  };

  if (cadenceError) {
    console.error('[expire-inactive] Failed to fetch cadences:', cadenceError.message);
    return { success: false, error: cadenceError.message };
  }

  if (!cadences?.length) {
    return { success: true, data: { cadences_scanned: 0, enrollments_expired: 0, leads_lost: 0 } };
  }

  // RPC does the heavy join (enrollment ↔ cadence ↔ last interaction) in one
  // round-trip. Returns one row per stale enrollment.
  const { data: candidates, error: rpcError } = (await (
    supabase.rpc as never as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: CandidateRow[] | null;
      error: { message: string } | null;
    }>
  )('fetch_inactive_enrollment_candidates', { p_include_completed: true }));

  if (rpcError) {
    console.error('[expire-inactive] RPC failed:', rpcError.message);
    return { success: false, error: rpcError.message };
  }

  if (!candidates?.length) {
    return {
      success: true,
      data: { cadences_scanned: cadences.length, enrollments_expired: 0, leads_lost: 0 },
    };
  }

  // Candidatos de cadência concluída entram com teto por org (o RPC já
  // devolve no máximo um por lead). Os mais parados primeiro — quem está há
  // mais tempo em limbo sai antes.
  const fromActive = candidates.filter((c) => c.enrollment_status !== 'completed');
  const fromCompletedByOrg = new Map<string, CandidateRow[]>();
  for (const row of candidates) {
    if (row.enrollment_status !== 'completed') continue;
    const list = fromCompletedByOrg.get(row.org_id) ?? [];
    list.push(row);
    fromCompletedByOrg.set(row.org_id, list);
  }
  const fromCompleted: CandidateRow[] = [];
  for (const list of fromCompletedByOrg.values()) {
    list.sort((a, b) => b.inactive_days - a.inactive_days);
    fromCompleted.push(...list.slice(0, MAX_COMPLETED_CANDIDATES_PER_ORG_PER_RUN));
  }

  const selected = [...fromActive, ...fromCompleted];

  // Dedup leads: a single lead can be active in multiple cadences with auto_loss
  // — we want to mark the lead 'unqualified' once.
  const leadFirstHit = new Map<string, CandidateRow>();
  for (const row of selected) {
    if (!leadFirstHit.has(row.lead_id)) leadFirstHit.set(row.lead_id, row);
  }

  const nowIso = new Date().toISOString();
  let enrollmentsExpired = 0;
  let leadsLost = 0;
  // Leads efetivamente perdidos nesta execução, para o gancho de recuperação
  // de inbound (agrupados por org + motivo do auto-loss).
  const lostForRecovery: Array<{ leadId: string; orgId: string; reasonId: string }> = [];

  // Stamp the enrollment side first so the cadence completion auto-fires
  // before we mutate the lead.
  //
  // Enrollment que JÁ estava 'completed' (fim natural da cadência) não é
  // reencerrado: sobrescrever status/completed_at apagaria a data real do fim
  // da cadência e estragaria as métricas de cadência. Nesses casos só o motivo
  // da perda é carimbado, e apenas se ainda estiver vazio.
  for (const row of selected) {
    const alreadyClosed = row.enrollment_status === 'completed';
    const lossNotes = `Auto-perda por inatividade (${row.inactive_days}d sem atividade)`;

    let query = from(supabase, 'cadence_enrollments')
      .update(
        (alreadyClosed
          ? { loss_reason_id: row.auto_loss_reason_id, loss_notes: lossNotes }
          : {
              status: 'completed',
              completed_at: nowIso,
              loss_reason_id: row.auto_loss_reason_id,
              loss_notes: lossNotes,
            }) as Record<string, unknown>,
      )
      .eq('id', row.enrollment_id);

    if (alreadyClosed) query = query.is('loss_reason_id', null);

    const { error: enrollError } = await query;
    if (enrollError) {
      console.error(`[expire-inactive] enrollment=${row.enrollment_id} update failed:`, enrollError.message);
      continue;
    }
    enrollmentsExpired++;
  }

  // Mark each unique lead 'unqualified'. lost_at is filled by the
  // set_qualified_at trigger.
  //
  // Order matters: insert the lead_lost interaction *before* the lead UPDATE.
  // If the function times out mid-loop or the UPDATE fails for whatever
  // reason, at least the timeline carries the audit trail — the SDR can see
  // *why* the lead left the cadence even when the status didn't transition.
  // (The 12/05/2026 V4 Amaral run lost 51 leads to this exact failure mode:
  // the enrollment-stamp loop completed, the lead-update loop hit timeout,
  // and those 51 leads sat as "contacted + sem cadência + timeline limpa"
  // until Guilherme reported it.)
  //
  // Idempotency: skip the interaction insert if one already exists for this
  // (lead, cadence, reason) tuple. This makes the job safe to re-run and
  // lets future runs heal earlier partial failures.
  for (const [leadId, row] of leadFirstHit) {
    const { data: existing } = (await from(supabase, 'interactions')
      .select('id')
      .eq('lead_id', leadId)
      .eq('cadence_id', row.cadence_id)
      .eq('channel', 'system')
      .filter('metadata->>reason', 'eq', 'auto_loss_inactivity')
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    if (!existing) {
      const { error: interactionError } = await from(supabase, 'interactions').insert({
        org_id: row.org_id,
        lead_id: leadId,
        cadence_id: row.cadence_id,
        channel: 'system',
        type: 'sent',
        message_content: `Lead marcado como perdido por inatividade (${row.inactive_days} dias sem atividade)`,
        metadata: {
          system_event: 'lead_lost',
          reason: 'auto_loss_inactivity',
          loss_reason_id: row.auto_loss_reason_id,
          inactive_days: row.inactive_days,
          // Permite medir depois quanto da perda veio do buraco do fim de
          // cadência (novo) e quanto do auto-loss que já existia.
          source: row.enrollment_status === 'completed' ? 'cadence_completed' : 'cadence_active',
        },
      } as Record<string, unknown>);
      if (interactionError) {
        console.error(`[expire-inactive] lead=${leadId} interaction insert failed:`, interactionError.message);
        // Don't continue — we still try to flip the lead status. A missing
        // interaction is recoverable on the next run; a missing status flip
        // would keep the lead in the SDR's funnel as still-active.
      }
    }

    const { error: leadError } = await from(supabase, 'leads')
      .update({
        status: 'unqualified',
        loss_reason_id: row.auto_loss_reason_id,
        loss_notes: `Auto-perda por inatividade (${row.inactive_days}d sem atividade)`,
      } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', row.org_id)
      .not('status', 'in', '("won","unqualified","archived")');
    if (leadError) {
      console.error(`[expire-inactive] lead=${leadId} update failed:`, leadError.message);
      continue;
    }
    leadsLost++;
    lostForRecovery.push({ leadId, orgId: row.org_id, reasonId: row.auto_loss_reason_id });
  }

  // Recuperação automática de inbound: auto-loss com motivo reativável (ex.:
  // "Nunca respondeu" nas cadências de Inbound) também redistribui o lead e
  // agenda a Recovery — mesma regra do perdido manual.
  //
  // Sem loop, em duas camadas: (1) o enrollment que a Recovery cria nasce
  // 'paused', e nem a parte A (só 'active') nem a parte B (que exige nenhum
  // enrollment 'active'/'paused' no lead) o alcançam; (2) quando a própria
  // Recovery conclui e o lead volta ao limbo, ele vira candidato da parte B —
  // mas o motivo de auto-loss da Recovery ("Deixou de responder") não está em
  // reasonNames, então nenhuma Recovery nova é agendada.
  if (lostForRecovery.length > 0) {
    const reasonIds = [...new Set(lostForRecovery.map((l) => l.reasonId))];
    const { data: reasons } = (await from(supabase, 'loss_reasons')
      .select('id, name')
      .in('id', reasonIds)) as { data: Array<{ id: string; name: string }> | null };
    const reasonNameById = new Map((reasons ?? []).map((r) => [r.id, r.name]));

    const groups = new Map<string, { orgId: string; reasonName: string; leadIds: string[] }>();
    for (const l of lostForRecovery) {
      const reasonName = reasonNameById.get(l.reasonId);
      if (!reasonName) continue;
      const key = `${l.orgId}:${l.reasonId}`;
      const group = groups.get(key) ?? { orgId: l.orgId, reasonName, leadIds: [] };
      group.leadIds.push(l.leadId);
      groups.set(key, group);
    }

    for (const group of groups.values()) {
      await scheduleInboundRecovery({
        orgId: group.orgId,
        leadIds: group.leadIds,
        lossReasonName: group.reasonName,
        userId: null,
      });
    }
  }

  const completedSkipped = candidates.filter((c) => c.enrollment_status === 'completed').length - fromCompleted.length;
  console.warn(
    `[expire-inactive] Complete: cadences_scanned=${cadences.length} ` +
      `enrollments_expired=${enrollmentsExpired} leads_lost=${leadsLost} ` +
      `(ativos=${fromActive.length} concluídos=${fromCompleted.length} adiados_pelo_teto=${completedSkipped})`,
  );

  return {
    success: true,
    data: {
      cadences_scanned: cadences.length,
      enrollments_expired: enrollmentsExpired,
      leads_lost: leadsLost,
    },
  };
}
