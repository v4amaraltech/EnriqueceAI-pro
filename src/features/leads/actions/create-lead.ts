'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { ERR_LEAD_LIMIT_REACHED } from '@/lib/constants/error-codes';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { exceedsLimit, isUnlimited } from '@/lib/utils/plan-limits';

import { enrollLeads } from '@/features/cadences/actions/manage-cadences';
import { dispatchWebhookEvent } from '@/features/cadences/services/webhook-dispatch.service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { RESOURCE_ALERT_THRESHOLD } from '@/lib/constants/limits';

import { createLeadSchema, normalizeOriginFields } from '../schemas/lead.schemas';
import { logLeadEvent } from './log-lead-event';

export async function createLead(
  rawData: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const parsed = createLeadSchema.safeParse(rawData);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return { success: false, error: firstError?.message ?? 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Check lead limit
  let currentLeads = 0;
  let maxLeads = 0;
  let hasLimitInfo = false;

  const { data: sub } = (await from(supabase, 'subscriptions')
    .select('plan_id')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { plan_id: string } | null };

  if (sub) {
    const { data: plan } = (await from(supabase, 'plans')
      .select('max_leads')
      .eq('id', sub.plan_id)
      .single()) as { data: { max_leads: number } | null };

    if (plan) {
      maxLeads = plan.max_leads;
      const { count: leadCount } = (await from(supabase, 'leads')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .is('deleted_at', null)) as { count: number | null };

      currentLeads = leadCount ?? 0;
      hasLimitInfo = true;

      if (exceedsLimit(currentLeads, 1, maxLeads)) {
        return {
          success: false,
          error: `Limite de leads atingido (${currentLeads}/${maxLeads}). Faça upgrade para adicionar mais.`,
          code: ERR_LEAD_LIMIT_REACHED,
        };
      }
    }
  }

  // Validate assigned_to belongs to same org
  const { data: assignee } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('user_id', parsed.data.assigned_to)
    .eq('org_id', orgId)
    .eq('status', 'active')
    .single()) as { data: { user_id: string } | null };

  if (!assignee) {
    return { success: false, error: 'Responsável não pertence à organização' };
  }

  // Check duplicate by email within same org
  if (parsed.data.email) {
    const { data: existingByEmail } = await from(supabase, 'leads')
      .select('id, email, first_name, last_name')
      .eq('org_id', orgId)
      .eq('email', parsed.data.email)
      .is('deleted_at', null)
      .maybeSingle();

    if (existingByEmail) {
      const name = [existingByEmail.first_name, existingByEmail.last_name].filter(Boolean).join(' ');
      return {
        success: false,
        error: `Já existe um lead com o email ${parsed.data.email}${name ? ` (${name})` : ''}`,
      };
    }
  }

  // Check duplicate by phone within same org
  if (parsed.data.telefone) {
    const cleanPhone = parsed.data.telefone.replace(/\D/g, '');
    if (cleanPhone.length >= 8) {
      const phoneSuffix = cleanPhone.slice(-8);
      const { data: existingByPhone } = (await from(supabase, 'leads')
        .select('id, telefone, first_name, last_name')
        .eq('org_id', orgId)
        .is('deleted_at', null)
        .like('telefone', `%${phoneSuffix}`)) as { data: Array<{ id: string; telefone: string | null; first_name: string | null; last_name: string | null }> | null };

      if (existingByPhone && existingByPhone.length > 0) {
        const dup = existingByPhone[0]!;
        const name = [dup.first_name, dup.last_name].filter(Boolean).join(' ');
        return {
          success: false,
          error: `Já existe um lead com o telefone ${parsed.data.telefone}${name ? ` (${name})` : ''}`,
        };
      }
    }
  }

  const normalized = normalizeOriginFields(parsed.data.lead_source, parsed.data.canal || null);

  // 1. Create the lead
  const { data: lead, error } = await from(supabase, 'leads')
    .insert({
      org_id: orgId,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      nome_fantasia: parsed.data.empresa,
      email: parsed.data.email,
      telefone: parsed.data.telefone,
      job_title: parsed.data.job_title,
      lead_source: normalized.lead_source,
      canal: normalized.canal,
      is_inbound: parsed.data.is_inbound,
      assigned_to: parsed.data.assigned_to,
      created_by: userId,
    } as Record<string, unknown>)
    .select('id')
    .single();

  if (error || !lead) {
    return { success: false, error: 'Erro ao criar lead' };
  }

  const leadId = (lead as { id: string }).id;

  // Log lead creation to timeline
  logLeadEvent(supabase, {
    orgId,
    leadId,
    userId,
    event: 'lead_created',
    message: `Lead criado manualmente por SDR`,
    metadata: { source: 'manual', canal: parsed.data.canal ?? null, lead_source: parsed.data.lead_source ?? null },
  });

  // Dispatch lead.created webhook
  dispatchWebhookEvent(supabase, orgId, 'lead.created', {
    lead_id: leadId,
    email: parsed.data.email ?? null,
    first_name: parsed.data.first_name,
    last_name: parsed.data.last_name ?? null,
  }).catch((err) => console.error('[webhook] lead.created dispatch failed:', err));

  // Notify assigned SDR if different from creator (manager assigned lead to SDR)
  const assignedTo = parsed.data.assigned_to;
  if (assignedTo && assignedTo !== userId) {
    import('@/features/notifications/services/notification.service').then(({ createNotification }) => {
      const leadName = parsed.data.empresa || [parsed.data.first_name, parsed.data.last_name].filter(Boolean).join(' ') || 'Lead';
      const isInbound = parsed.data.is_inbound === true;
      createNotification({
        org_id: orgId,
        user_id: assignedTo,
        type: isInbound ? 'lead_inbound' : 'activity_reminder',
        title: isInbound ? `Novo lead inbound: ${leadName}` : `Novo lead atribuído: ${leadName}`,
        body: [parsed.data.lead_source, parsed.data.canal].filter(Boolean).join(' / ') || 'Criado manualmente',
        resource_type: 'lead',
        resource_id: leadId,
      }).catch((err: unknown) => console.error('[notification] lead_assigned failed:', err));
    });
  }

  // 2. Enroll in cadence if selected (non-blocking for lead creation)
  const cadenceId = parsed.data.cadence_id;
  if (cadenceId) {
    try {
      const result = await enrollLeads(cadenceId, [leadId], 'active');

      // If scheduled start, update enrollment's next_step_due
      if (result.success && parsed.data.enrollment_mode === 'scheduled' && parsed.data.scheduled_start) {
        await from(supabase, 'cadence_enrollments')
          .update({ next_step_due: parsed.data.scheduled_start })
          .eq('lead_id', leadId)
          .eq('cadence_id', cadenceId);
      }
    } catch {
      // Enrollment failure should not fail lead creation
    }
  }

  // Enrichment via CNPJ is only triggered for CSV imports, not manual creation

  // 3. Fire 80% lead threshold alert (fire-and-forget). Skipped for unlimited
  // plans — there's no meaningful threshold to alert on.
  if (hasLimitInfo && maxLeads > 0 && !isUnlimited(maxLeads)) {
    const newCount = currentLeads + 1;
    const threshold = Math.floor(maxLeads * RESOURCE_ALERT_THRESHOLD);
    if (currentLeads < threshold && newCount >= threshold) {
      fireLeadThresholdAlert(orgId, newCount, maxLeads).catch((err) =>
        console.error('[leads] Failed to send threshold alert:', err),
      );
    }
  }

  revalidatePath('/leads');

  return { success: true, data: { id: leadId } };
}

async function fireLeadThresholdAlert(orgId: string, used: number, limit: number): Promise<void> {
  // Deduplicate: check if alert already sent today
  const supabase = createServiceRoleClient();
  const today = new Date().toISOString().split('T')[0]!;

  const { data: existing } = (await from(supabase, 'notifications')
    .select('id')
    .eq('org_id', orgId)
    .eq('type', 'usage_limit_alert')
    .gte('created_at', `${today}T00:00:00`)
    .lt('created_at', `${today}T23:59:59.999`)
    .contains('metadata', { channel: 'leads' } as unknown as Record<string, unknown>)
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  if (existing) return;

  const pct = Math.round((used / limit) * 100);
  await createNotificationsForOrgMembers({
    orgId,
    type: 'usage_limit_alert',
    title: `Leads: ${pct}% do limite utilizado`,
    body: `Sua organização já tem ${used} de ${limit} leads. Considere fazer upgrade do plano.`,
    metadata: { channel: 'leads', used, limit, percentage: pct },
    roleFilter: 'manager',
  });
}
