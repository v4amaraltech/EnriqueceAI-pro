'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { DialerStats } from '../schemas/dialer-preferences.schemas';

export async function fetchDialerStats(): Promise<ActionResult<DialerStats>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) {
    return {
      success: true,
      data: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 },
    };
  }
  const { orgId, supabase } = auth.data;

  // Get dialer daily limit setting
  const { data: settings } = (await from(supabase, 'organization_call_settings')
    .select('dialer_daily_limit_per_lead')
    .eq('org_id', orgId)
    .single()) as { data: { dialer_daily_limit_per_lead: number } | null };

  const dailyLimit = settings?.dialer_daily_limit_per_lead ?? 3;

  // Get active enrollments where current step is a phone step
  const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
    .select('id, lead_id, cadence_id, current_step, lead:leads(id, telefone)')
    .eq('status', 'active')
    .lte('next_step_due', new Date().toISOString())) as {
    data: Array<{
      id: string;
      lead_id: string;
      cadence_id: string;
      current_step: number;
      lead: { id: string; telefone: string | null } | null;
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

  // Count leads without phone
  const leadsWithoutPhone = phoneEnrollments.filter(
    (e) => !e.lead?.telefone,
  ).length;

  // Count leads at daily limit — check calls made today
  const leadIds = [...new Set(phoneEnrollments.map((e) => e.lead_id))];
  // BRT midnight: shift "now" by -3h then truncate to UTC midnight, shift back
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const todayStart = new Date(Date.UTC(nowBrt.getUTCFullYear(), nowBrt.getUTCMonth(), nowBrt.getUTCDate()) + 3 * 60 * 60 * 1000);

  const { data: todayCalls } = (await from(supabase, 'calls')
    .select('lead_id')
    .in('lead_id', leadIds)
    .gte('started_at', todayStart.toISOString())) as {
    data: Array<{ lead_id: string }> | null;
  };

  // Count calls per lead today
  const callsPerLead = new Map<string, number>();
  for (const c of todayCalls ?? []) {
    callsPerLead.set(c.lead_id, (callsPerLead.get(c.lead_id) ?? 0) + 1);
  }

  const leadsAtDailyLimit = phoneEnrollments.filter((e) => {
    const count = callsPerLead.get(e.lead_id) ?? 0;
    return count >= dailyLimit;
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
