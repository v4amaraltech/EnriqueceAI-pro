'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';

/**
 * Daily job that expires cadence_enrollments whose lead has been inactive
 * longer than the cadence's auto_loss_after_days threshold. Marks the lead
 * 'unqualified', the enrollment 'completed', and stamps the cadence's
 * auto_loss_reason_id on the enrollment so loss-reason charts attribute it
 * correctly.
 *
 * Inactivity = days since the most recent interaction on the lead, falling
 * back to enrolled_at when the lead has never had any interactions logged.
 */
interface CandidateRow {
  enrollment_id: string;
  lead_id: string;
  org_id: string;
  cadence_id: string;
  auto_loss_reason_id: string;
  auto_loss_after_days: number;
  inactive_days: number;
}

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
    supabase.rpc as never as (fn: string) => Promise<{
      data: CandidateRow[] | null;
      error: { message: string } | null;
    }>
  )('fetch_inactive_enrollment_candidates'));

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

  // Dedup leads: a single lead can be active in multiple cadences with auto_loss
  // — we want to mark the lead 'unqualified' once.
  const leadFirstHit = new Map<string, CandidateRow>();
  for (const row of candidates) {
    if (!leadFirstHit.has(row.lead_id)) leadFirstHit.set(row.lead_id, row);
  }

  const nowIso = new Date().toISOString();
  let enrollmentsExpired = 0;
  let leadsLost = 0;

  // Stamp the enrollment side first so the cadence completion auto-fires
  // before we mutate the lead.
  for (const row of candidates) {
    const { error: enrollError } = await from(supabase, 'cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: nowIso,
        loss_reason_id: row.auto_loss_reason_id,
        loss_notes: `Auto-perda por inatividade (${row.inactive_days}d sem atividade)`,
      } as Record<string, unknown>)
      .eq('id', row.enrollment_id);
    if (enrollError) {
      console.error(`[expire-inactive] enrollment=${row.enrollment_id} update failed:`, enrollError.message);
      continue;
    }
    enrollmentsExpired++;
  }

  // Mark each unique lead 'unqualified'. lost_at is filled by the
  // set_qualified_at trigger.
  for (const [leadId, row] of leadFirstHit) {
    const { error: leadError } = await from(supabase, 'leads')
      .update({ status: 'unqualified' } as Record<string, unknown>)
      .eq('id', leadId)
      .eq('org_id', row.org_id);
    if (leadError) {
      console.error(`[expire-inactive] lead=${leadId} update failed:`, leadError.message);
      continue;
    }
    leadsLost++;

    // Audit trail in lead timeline
    await from(supabase, 'interactions').insert({
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
      },
    } as Record<string, unknown>);
  }

  console.warn(
    `[expire-inactive] Complete: cadences_scanned=${cadences.length} enrollments_expired=${enrollmentsExpired} leads_lost=${leadsLost}`,
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
