'use server';

import { revalidatePath } from 'next/cache';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/actions/action-result';
import { logAudit } from '@/lib/audit/audit-log';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { logLeadEvent } from './log-lead-event';
import { recalcFitScoreForLead } from './recalc-fit-scores';

/**
 * Resume paused enrollments when lead data is updated.
 * Finds enrollments paused due to missing email/phone and reactivates them.
 */
async function resumePausedEnrollments(
  supabase: SupabaseClient,
  leadId: string,
  reasons: string[],
): Promise<number> {
  // Find paused enrollments that have a failed interaction with one of the given reasons
  const { data: failedInteractions } = (await from(supabase, 'interactions')
    .select('cadence_id')
    .eq('lead_id', leadId)
    .eq('type', 'failed')
    .filter('metadata->>error', 'in', `(${reasons.join(',')})`)
  ) as { data: Array<{ cadence_id: string }> | null };

  if (!failedInteractions?.length) return 0;

  const cadenceIds = [...new Set(failedInteractions.map((i) => i.cadence_id))];

  // Resume only enrollments that are paused AND belong to active cadences
  const { data: updated } = (await from(supabase, 'cadence_enrollments')
    .update({ status: 'active' } as Record<string, unknown>)
    .eq('lead_id', leadId)
    .eq('status', 'paused')
    .in('cadence_id', cadenceIds)
    .select('id')
  ) as { data: Array<{ id: string }> | null };

  const count = updated?.length ?? 0;
  if (count > 0) {
    console.warn(`[lead-update] Resumed ${count} paused enrollments for lead=${leadId} reasons=${reasons.join(',')}`);
  }
  return count;
}

export async function updateLead(
  leadId: string,
  updates: Record<string, unknown>,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Only allow safe fields
  const safeFields = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'phones', 'status', 'notes', 'socios', 'instagram', 'linkedin', 'website', 'first_name', 'last_name', 'job_title', 'lead_source', 'canal', 'cnpj', 'is_inbound', 'email_bounced_at', 'custom_field_values', 'closer_id', 'assigned_to', 'faturamento_estimado'];
  const safeUpdates: Record<string, unknown> = {};
  for (const key of safeFields) {
    if (key in updates) {
      safeUpdates[key] = updates[key];
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    return { success: false, error: 'Nenhum campo válido para atualizar' };
  }

  // Sanitize CNPJ: strip formatting (dots, slashes, hyphens) and convert empty to null
  if ('cnpj' in safeUpdates) {
    const rawCnpj = (safeUpdates.cnpj as string)?.replace(/\D/g, '').trim();
    safeUpdates.cnpj = rawCnpj ? rawCnpj : null;
  }
  if ('canal' in safeUpdates && !(safeUpdates.canal as string)?.trim()) {
    delete safeUpdates.canal;
  }

  // Auto-set stage timestamps when status changes
  if ('status' in safeUpdates) {
    const now = new Date().toISOString();
    const statusTimestamps: Record<string, string> = {
      contacted: 'contacted_at',
      archived: 'archived_at',
    };
    const tsField = statusTimestamps[safeUpdates.status as string];
    if (tsField) safeUpdates[tsField] = now;
  }

  // Fetch current lead to detect changes (for audit + email/phone resume)
  const { data: currentLead } = (await from(supabase, 'leads')
    .select('*')
    .eq('id', leadId)
    .eq('org_id', orgId)
    .single()) as { data: Record<string, unknown> | null };

  // If email is being updated and it changed, clear bounce flag
  const newEmail = safeUpdates.email as string | undefined;
  const emailChanged = newEmail !== undefined && newEmail !== (currentLead?.email as string | null) && newEmail;
  if (emailChanged && currentLead?.email_bounced_at) {
    safeUpdates.email_bounced_at = null;
  }

  const { error } = await from(supabase, 'leads')
    .update(safeUpdates as Record<string, unknown>)
    .eq('id', leadId)
    .eq('org_id', orgId);

  if (error) {
    console.error('[updateLead] Error:', error.message, 'Fields:', Object.keys(safeUpdates));
    return { success: false, error: 'Erro ao atualizar lead. Tente novamente.' };
  }

  // Log field changes to audit log
  if (currentLead) {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [key, newVal] of Object.entries(safeUpdates)) {
      const oldVal = currentLead[key];
      // Compare serialized values to handle objects (custom_field_values, phones, socios)
      if (JSON.stringify(oldVal ?? null) !== JSON.stringify(newVal ?? null)) {
        changes[key] = { from: oldVal ?? null, to: newVal ?? null };
      }
    }
    if (Object.keys(changes).length > 0) {
      logAudit({
        orgId,
        userId: auth.data.userId,
        action: 'lead.fields_updated',
        resourceType: 'lead',
        resourceId: leadId,
        metadata: { changes },
      });

      // Log to lead timeline
      const fieldLabels: Record<string, string> = {
        first_name: 'Nome', last_name: 'Sobrenome', nome_fantasia: 'Empresa', email: 'Email',
        telefone: 'Telefone', job_title: 'Cargo', lead_source: 'Origem', canal: 'Sub-origem',
        cnpj: 'CNPJ', instagram: 'Instagram', linkedin: 'LinkedIn', website: 'Website',
        status: 'Status', assigned_to: 'Responsável', closer_id: 'Closer',
        faturamento_estimado: 'Faturamento', phones: 'Telefones',
      };
      const changedFields = Object.keys(changes)
        .map((k) => fieldLabels[k] ?? k)
        .join(', ');
      logLeadEvent(supabase, {
        orgId,
        leadId,
        userId: auth.data.userId,
        event: 'fields_updated',
        message: `Campos atualizados: ${changedFields}`,
        metadata: { changes },
      });
    }
  }

  // Resume paused enrollments when email/phone is added or changed
  const newTelefone = safeUpdates.telefone as string | undefined;
  const telefoneChanged = newTelefone !== undefined && newTelefone !== (currentLead?.telefone as string | null) && newTelefone;

  if (emailChanged || telefoneChanged) {
    const reasons: string[] = [];
    if (emailChanged) reasons.push('no_lead_email', 'email_bounced');
    if (telefoneChanged) reasons.push('invalid_phone');
    resumePausedEnrollments(supabase, leadId, reasons).catch(() => {
      // Fire-and-forget
    });
  }

  // Recalc fit score if relevant fields changed
  const fitScoreFields = ['razao_social', 'nome_fantasia', 'email', 'telefone', 'notes'];
  const hasRelevantChange = fitScoreFields.some((f) => f in safeUpdates);
  if (hasRelevantChange) {
    recalcFitScoreForLead(supabase, leadId, orgId).catch(() => {
      // Fire-and-forget: don't block the update response
    });
  }

  revalidatePath('/leads');
  revalidatePath(`/leads/${leadId}`);

  return { success: true, data: undefined };
}
