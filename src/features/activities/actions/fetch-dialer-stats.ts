'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { chunkedIn } from '@/lib/supabase/chunked-in';
import { from } from '@/lib/supabase/from';
import { brtDayStartIso, brtTodayIso } from '@/lib/utils/brt-date';

import type { LeadPhone, LeadSocio } from '@/features/leads/types';

import type { DialerStats } from '../schemas/dialer-preferences.schemas';
import { countCallsByPhone, phoneKey } from '../utils/auto-dialer';
import { getAllLeadPhones } from '../utils/resolve-whatsapp-phone';

export async function fetchDialerStats(): Promise<ActionResult<DialerStats>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) {
    return {
      success: true,
      data: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 },
    };
  }
  const { orgId, supabase, userId, role } = auth.data;

  // Get dialer daily limit setting
  const { data: settings } = (await from(supabase, 'organization_call_settings')
    .select('dialer_daily_limit_per_lead')
    .eq('org_id', orgId)
    .single()) as { data: { dialer_daily_limit_per_lead: number } | null };

  const dailyLimit = settings?.dialer_daily_limit_per_lead ?? 3;

  // Get active enrollments where current step is a phone step. Posse: SDR só os
  // próprios leads (leads!inner + assigned_to; não confiar no RLS, que em modo
  // 'all' deixa de escopar); manager, a org toda.
  let enrollQuery = from(supabase, 'cadence_enrollments')
    .select('id, lead_id, cadence_id, current_step, lead:leads!inner(id, telefone, socios, phones)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString());
  if (role !== 'manager') enrollQuery = enrollQuery.eq('lead.assigned_to', userId);
  const { data: enrollments } = (await enrollQuery) as {
    data: Array<{
      id: string;
      lead_id: string;
      cadence_id: string;
      current_step: number;
      lead: { id: string; telefone: string | null; socios: LeadSocio[] | null; phones: LeadPhone[] | null } | null;
    }> | null;
  };

  if (!enrollments || enrollments.length === 0) {
    return {
      success: true,
      data: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 },
    };
  }

  // Get phone steps for these cadences
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];
  const { data: phoneSteps } = (await from(supabase, 'cadence_steps')
    .select('cadence_id, step_order')
    .in('cadence_id', cadenceIds)
    .eq('channel', 'phone')) as {
    data: Array<{ cadence_id: string; step_order: number }> | null;
  };

  // Build phone step set
  const phoneStepSet = new Set<string>();
  for (const s of phoneSteps ?? []) {
    phoneStepSet.add(`${s.cadence_id}:${s.step_order}`);
  }

  // Filter enrollments to only those at a phone step
  const phoneEnrollments = enrollments.filter((e) =>
    phoneStepSet.has(`${e.cadence_id}:${e.current_step}`),
  );

  if (phoneEnrollments.length === 0) {
    return {
      success: true,
      data: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 },
    };
  }

  // Números de cada lead (mesma resolução da fila do Power Dialer).
  const phonesByEnrollment = new Map(
    phoneEnrollments.map((e) => [e.id, e.lead ? getAllLeadPhones(e.lead).map((p) => p.formatted) : []]),
  );

  const leadsWithoutPhone = phoneEnrollments.filter((e) => (phonesByEnrollment.get(e.id) ?? []).length === 0).length;

  // No limite do dia = TODOS os números do lead atingiram o limite (o limite é
  // por número desde a story power-dialer-rounds, 05/11/2026).
  const leadIds = [...new Set(phoneEnrollments.map((e) => e.lead_id))];
  const todayCalls = await chunkedIn<{ destination: string | null; started_at: string | null }>(leadIds, (chunk) =>
    from(supabase, 'calls')
      .select('destination, started_at')
      .in('lead_id', chunk)
      .gte('started_at', brtDayStartIso(brtTodayIso())) as unknown as PromiseLike<{
      data: Array<{ destination: string | null; started_at: string | null }> | null;
      error: unknown;
    }>,
  );
  const callsByPhone = countCallsByPhone(todayCalls);

  const leadsAtDailyLimit = phoneEnrollments.filter((e) => {
    const phones = phonesByEnrollment.get(e.id) ?? [];
    return phones.length > 0 && phones.every((p) => (callsByPhone.get(phoneKey(p))?.count ?? 0) >= dailyLimit);
  }).length;

  const totalPhoneLeads = phoneEnrollments.length;
  const leadsWithSnooze = 0; // No snooze mechanism yet

  return {
    success: true,
    data: {
      leadsWithoutPhone,
      leadsAtDailyLimit,
      leadsWithSnooze,
      totalAvailable: Math.max(0, totalPhoneLeads - leadsWithoutPhone - leadsAtDailyLimit - leadsWithSnooze),
    },
  };
}
