'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { enrollLeads } from '@/features/cadences/actions/manage-cadences';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

import { createLeadSchema } from '../schemas/lead.schemas';
import { enrichLeadAction } from './enrich-lead';

const ALERT_THRESHOLD = 0.8;

export async function createLead(
  rawData: Record<string, unknown>,
): Promise<ActionResult<{ id: string }>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const parsed = createLeadSchema.safeParse(rawData);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0];
    return { success: false, error: firstError?.message ?? 'Dados inválidos' };
  }

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Check lead limit
  let currentLeads = 0;
  let maxLeads = 0;
  let hasLimitInfo = false;

  const { data: sub } = (await (supabase
    .from('subscriptions') as ReturnType<typeof supabase.from>)
    .select('plan_id')
    .eq('org_id', member.org_id)
    .maybeSingle()) as { data: { plan_id: string } | null };

  if (sub) {
    const { data: plan } = (await (supabase
      .from('plans') as ReturnType<typeof supabase.from>)
      .select('max_leads')
      .eq('id', sub.plan_id)
      .single()) as { data: { max_leads: number } | null };

    if (plan) {
      maxLeads = plan.max_leads;
      const { count: leadCount } = (await (supabase
        .from('leads') as ReturnType<typeof supabase.from>)
        .select('id', { count: 'exact', head: true })
        .eq('org_id', member.org_id)
        .is('deleted_at', null)) as { count: number | null };

      currentLeads = leadCount ?? 0;
      hasLimitInfo = true;

      if (currentLeads >= maxLeads) {
        return {
          success: false,
          error: `Limite de leads atingido (${currentLeads}/${maxLeads}). Faça upgrade para adicionar mais.`,
          code: 'LEAD_LIMIT_REACHED',
        };
      }
    }
  }

  // Validate assigned_to belongs to same org
  const { data: assignee } = (await supabase
    .from('organization_members')
    .select('user_id')
    .eq('user_id', parsed.data.assigned_to)
    .eq('org_id', member.org_id)
    .eq('status', 'active')
    .single()) as { data: { user_id: string } | null };

  if (!assignee) {
    return { success: false, error: 'Responsável não pertence à organização' };
  }

  // 1. Create the lead
  const { data: lead, error } = await (supabase
    .from('leads') as ReturnType<typeof supabase.from>)
    .insert({
      org_id: member.org_id,
      first_name: parsed.data.first_name,
      last_name: parsed.data.last_name,
      nome_fantasia: parsed.data.empresa,
      email: parsed.data.email,
      telefone: parsed.data.telefone,
      job_title: parsed.data.job_title,
      lead_source: parsed.data.lead_source,
      is_inbound: parsed.data.is_inbound,
      assigned_to: parsed.data.assigned_to,
      created_by: user.id,
    } as Record<string, unknown>)
    .select('id')
    .single();

  if (error || !lead) {
    return { success: false, error: 'Erro ao criar lead' };
  }

  const leadId = (lead as { id: string }).id;

  // 2. Enroll in cadence if selected (non-blocking for lead creation)
  const cadenceId = parsed.data.cadence_id;
  if (cadenceId) {
    try {
      const result = await enrollLeads(cadenceId, [leadId], 'active');

      // If scheduled start, update enrollment's next_step_due
      if (result.success && parsed.data.enrollment_mode === 'scheduled' && parsed.data.scheduled_start) {
        await supabase
          .from('cadence_enrollments')
          .update({ next_step_due: parsed.data.scheduled_start })
          .eq('lead_id', leadId)
          .eq('cadence_id', cadenceId);
      }
    } catch {
      // Enrollment failure should not fail lead creation
    }
  }

  // 3. Trigger enrichment (awaited to avoid runtime cutoff, but errors swallowed)
  await enrichLeadAction(leadId).catch(() => {
    // Enrichment failure should not fail lead creation
  });

  // 4. Fire 80% lead threshold alert (fire-and-forget)
  if (hasLimitInfo && maxLeads > 0) {
    const newCount = currentLeads + 1;
    const threshold = Math.floor(maxLeads * ALERT_THRESHOLD);
    if (currentLeads < threshold && newCount >= threshold) {
      fireLeadThresholdAlert(member.org_id, newCount, maxLeads).catch((err) =>
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

  const { data: existing } = (await (supabase
    .from('notifications') as ReturnType<typeof supabase.from>)
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
