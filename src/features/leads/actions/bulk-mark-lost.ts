'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { MAX_BULK_LEAD_IDS } from '@/lib/constants/limits';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';

import { logLeadEventBulk } from './log-lead-event';

const bulkMarkLostSchema = z.object({
  leadIds: z.array(z.string().uuid()).min(1, 'Nenhum lead selecionado').max(MAX_BULK_LEAD_IDS),
  lossReasonId: z.string().uuid('Motivo de perda inválido'),
  lossNotes: z.string().trim().max(2000).optional(),
});

/**
 * Mark multiple leads as lost (unqualified) with a single loss reason.
 *
 * Bulk counterpart of markLeadAsLost — replaces the former bulk "archive"
 * action. Loss reason and notes apply to every selected lead. Unlike the
 * single-lead dialog, there's no "schedule new prospection" step (a single
 * date/cadence wouldn't make sense across many leads).
 */
export async function bulkMarkLeadsLost(
  leadIds: string[],
  lossReasonId: string,
  lossNotes?: string,
): Promise<ActionResult<{ count: number }>> {
  const parsed = bulkMarkLostSchema.safeParse({ leadIds, lossReasonId, lossNotes });
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }
  const notes = parsed.data.lossNotes || undefined;

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Validate the loss reason belongs to this org (defense against cross-tenant ids)
  const { data: reason } = (await from(supabase, 'loss_reasons')
    .select('id, name')
    .eq('id', lossReasonId)
    .eq('org_id', orgId)
    .single()) as { data: { id: string; name: string } | null };
  if (!reason) {
    return { success: false, error: 'Motivo de perda não encontrado' };
  }

  // 1. Update leads → unqualified + persist loss reason (org-scoped)
  const { error: leadError } = await from(supabase, 'leads')
    .update({
      status: 'unqualified',
      loss_reason_id: lossReasonId,
      loss_notes: notes ?? null,
    } as Record<string, unknown>)
    .eq('org_id', orgId)
    .in('id', leadIds);

  if (leadError) {
    return { success: false, error: 'Erro ao marcar leads como perdidos' };
  }

  // 2. Complete active/paused enrollments + cancel pending scheduled activities
  // (service role to bypass RLS), so lost leads stop surfacing in the SDR queue.
  const serviceClient = createServiceRoleClient();
  await from(serviceClient, 'cadence_enrollments')
    .update({
      status: 'completed',
      loss_reason_id: lossReasonId,
      completed_at: new Date().toISOString(),
      ...(notes ? { loss_notes: notes } : {}),
    } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .in('status', ['active', 'paused']);

  await from(serviceClient, 'scheduled_activities' as never)
    .update({ status: 'cancelled' } as Record<string, unknown>)
    .in('lead_id', leadIds)
    .eq('status', 'pending');

  // 3. Timeline event per lead
  const lossMessage = `Lead marcado como perdido — Motivo: ${reason.name}${notes ? ` | Obs: ${notes}` : ''}`;
  await logLeadEventBulk(supabase, {
    orgId,
    leadIds,
    userId,
    event: 'lead_lost',
    message: lossMessage,
    metadata: { loss_reason_id: lossReasonId, loss_reason_name: reason.name },
  });

  // 4. Aggregate manager notification (one, not N)
  createNotificationsForOrgMembers({
    orgId,
    type: 'lead_lost',
    title: `${leadIds.length} lead(s) marcados como perdidos`,
    body: `Motivo: ${reason.name}`,
    resourceType: 'lead',
    resourceId: leadIds[0] ?? '',
    roleFilter: 'manager',
    excludeUserId: userId,
  }).catch((err) => console.error('[notification] bulk lead_lost failed:', err));

  // 5. Webhook per lead (fire-and-forget)
  for (const leadId of leadIds) {
    dispatchWebhookEvent(supabase, orgId, 'lead.unqualified', {
      lead_id: leadId,
      loss_reason_id: lossReasonId,
      loss_notes: notes ?? null,
    }).catch((err) => console.error('[webhook] bulk lead.unqualified dispatch failed:', err));
  }

  revalidatePath('/leads');
  revalidatePath('/atividades');
  return { success: true, data: { count: leadIds.length } };
}
