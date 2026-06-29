'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { safeRate } from '@/lib/utils/format';

import type { AutoEmailCadenceMetrics } from '../cadences.contract';

const cadenceIdsSchema = z.array(z.string().uuid()).max(100);

/** Rolling window (days) for the health-badge fail rate — a recent deliverability signal. */
const RECENT_FAIL_WINDOW_DAYS = 14;

export async function fetchAutoEmailMetrics(
  cadenceIds: string[],
): Promise<ActionResult<Record<string, AutoEmailCadenceMetrics>>> {
  const parsed = cadenceIdsSchema.safeParse(cadenceIds);
  if (!parsed.success) return { success: false, error: 'IDs inválidos' };

  if (parsed.data.length === 0) {
    return { success: true, data: {} };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // Fetch enrollment counts grouped by cadence_id + status
  const { data: enrollmentRows, error: enrollmentError } = (await from(supabase, 'cadence_enrollments')
    .select('cadence_id, status')
    .in('cadence_id', cadenceIds)) as {
    data: Array<{ cadence_id: string; status: string }> | null;
    error: { message: string } | null;
  };

  if (enrollmentError) {
    return { success: false, error: 'Erro ao buscar métricas de enrollments' };
  }

  // Fetch interaction rows (incl. lead_id) grouped by cadence_id + type.
  // lead_id powers per-prospect rates (unique leads who acted, not raw events).
  const { data: interactionRows, error: interactionError } = (await from(supabase, 'interactions')
    .select('cadence_id, type, lead_id, created_at')
    .in('cadence_id', cadenceIds)) as {
    data: Array<{ cadence_id: string; type: string; lead_id: string | null; created_at: string }> | null;
    error: { message: string } | null;
  };

  if (interactionError) {
    return { success: false, error: 'Erro ao buscar métricas de interações' };
  }

  // Aggregate enrollment counts per cadence
  const enrollmentCounts: Record<string, Record<string, number>> = {};
  for (const row of enrollmentRows ?? []) {
    if (!enrollmentCounts[row.cadence_id]) {
      enrollmentCounts[row.cadence_id] = {};
    }
    const bucket = enrollmentCounts[row.cadence_id]!;
    bucket[row.status] = (bucket[row.status] ?? 0) + 1;
  }

  // Aggregate interaction counts (raw event volume), distinct-lead sets
  // (per-prospect reach), and recent-window counts (health signal) per cadence + type.
  const recentCutoffMs = Date.now() - RECENT_FAIL_WINDOW_DAYS * 86_400_000;
  const interactionCounts: Record<string, Record<string, number>> = {};
  const interactionLeads: Record<string, Record<string, Set<string>>> = {};
  const recentCounts: Record<string, Record<string, number>> = {};
  for (const row of interactionRows ?? []) {
    if (!interactionCounts[row.cadence_id]) {
      interactionCounts[row.cadence_id] = {};
    }
    const bucket = interactionCounts[row.cadence_id]!;
    bucket[row.type] = (bucket[row.type] ?? 0) + 1;

    if (row.lead_id) {
      if (!interactionLeads[row.cadence_id]) {
        interactionLeads[row.cadence_id] = {};
      }
      const leadBucket = interactionLeads[row.cadence_id]!;
      if (!leadBucket[row.type]) {
        leadBucket[row.type] = new Set();
      }
      leadBucket[row.type]!.add(row.lead_id);
    }

    // H6: recent-window tally for the health-badge fail rate.
    if (new Date(row.created_at).getTime() >= recentCutoffMs) {
      if (!recentCounts[row.cadence_id]) {
        recentCounts[row.cadence_id] = {};
      }
      const recentBucket = recentCounts[row.cadence_id]!;
      recentBucket[row.type] = (recentBucket[row.type] ?? 0) + 1;
    }
  }

  // Build metrics map
  const metrics: Record<string, AutoEmailCadenceMetrics> = {};

  for (const cadenceId of cadenceIds) {
    const ec = enrollmentCounts[cadenceId] ?? {};
    const ic = interactionCounts[cadenceId] ?? {};
    const il = interactionLeads[cadenceId] ?? {};
    const rc = recentCounts[cadenceId] ?? {};

    // H6: fail rate over the recent window (deliverability signal). null when no
    // recent sends — the health badge falls back to the all-time rate.
    const recentAttempts = (rc['sent'] ?? 0) + (rc['failed'] ?? 0) + (rc['bounced'] ?? 0);
    const recentFailRate =
      recentAttempts > 0 ? (((rc['failed'] ?? 0) + (rc['bounced'] ?? 0)) / recentAttempts) * 100 : null;

    // Raw event volume (shown in the count columns).
    const sent = ic['sent'] ?? 0;
    const replied = ic['replied'] ?? 0;
    const opened = ic['opened'] ?? 0;

    // Per-prospect reach (unique leads) powering the rate columns. The same lead
    // opens an email multiple times, so rates use distinct leads, not raw events.
    const sentLeads = il['sent']?.size ?? 0;
    const openedLeads = il['opened']?.size ?? 0;
    const repliedLeads = il['replied']?.size ?? 0;

    metrics[cadenceId] = {
      cadenceId,
      active: ec['active'] ?? 0,
      paused: ec['paused'] ?? 0,
      completed: ec['completed'] ?? 0,
      // "Respondido" and "Rejeitado" read from interactions (the canonical
      // signal), not enrollment status. Enrollment status only flips while the
      // enrollment is still 'active' (see recordReply / recordBounce), so it
      // undercounts replies/bounces that land after the sequence ends.
      replied,
      bounced: ic['bounced'] ?? 0,
      sent,
      delivered: ic['delivered'] ?? 0,
      opened,
      failed: ic['failed'] ?? 0,
      meetings: ic['meeting_scheduled'] ?? 0,
      // Rates are per unique prospect: leads who replied/opened ÷ leads emailed.
      replyRate: safeRate(repliedLeads, sentLeads),
      openRate: safeRate(openedLeads, sentLeads),
      recentFailRate,
    };
  }

  return { success: true, data: metrics };
}

