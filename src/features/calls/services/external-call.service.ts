import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { normalizePhone } from '@/lib/utils/phone';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';

export interface LeadMatch {
  leadId: string;
  enrollmentId: string | null;
  cadenceId: string | null;
  currentStep: number | null;
  stepChannel: string | null;
}

/**
 * Find a lead by phone number within an org, checking:
 *  1. leads.telefone (direct text)
 *  2. leads.phones JSONB (array of {tipo, numero})
 *  3. leads.socios JSONB (celulares sub-array)
 *
 * If found, also checks for an active cadence enrollment.
 * Uses service-role client (no auth context needed — called from webhook).
 */
export async function findLeadByPhoneService(
  supabase: SupabaseClient,
  orgId: string,
  phone: string,
): Promise<LeadMatch | null> {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 8) return null;

  const phoneSuffix = sanitizeFilterValue(normalized.slice(-8));

  // 1. Search leads.telefone
  const { data: directMatch } = (await from(supabase, 'leads')
    .select('id')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .like('telefone', `%${phoneSuffix}`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as { data: { id: string } | null };

  let leadId: string | null = directMatch?.id ?? null;

  // 2. Search leads.phones JSONB (cast to text and search)
  if (!leadId) {
    const { data: phonesMatch } = (await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .like('phones::text' as never, `%${phoneSuffix}%` as never)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    leadId = phonesMatch?.id ?? null;
  }

  // 3. Search leads.socios JSONB celulares
  if (!leadId) {
    const { data: socioMatch } = (await from(supabase, 'leads')
      .select('id')
      .eq('org_id', orgId)
      .is('deleted_at', null)
      .like('socios::text' as never, `%${phoneSuffix}%` as never)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };

    leadId = socioMatch?.id ?? null;
  }

  if (!leadId) return null;

  // Check for active cadence enrollment
  const enrollment = await findActiveEnrollment(supabase, leadId);

  return {
    leadId,
    enrollmentId: enrollment?.id ?? null,
    cadenceId: enrollment?.cadenceId ?? null,
    currentStep: enrollment?.currentStep ?? null,
    stepChannel: enrollment?.stepChannel ?? null,
  };
}

async function findActiveEnrollment(
  supabase: SupabaseClient,
  leadId: string,
): Promise<{ id: string; cadenceId: string; currentStep: number; stepChannel: string | null } | null> {
  const { data: enrollment } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, current_step')
    .eq('lead_id', leadId)
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data: { id: string; cadence_id: string; current_step: number } | null;
  };

  if (!enrollment) return null;

  // Get the current step's channel
  const { data: step } = (await from(supabase, 'cadence_steps')
    .select('id, channel')
    .eq('cadence_id', enrollment.cadence_id)
    .eq('step_order', enrollment.current_step)
    .maybeSingle()) as { data: { id: string; channel: string } | null };

  return {
    id: enrollment.id,
    cadenceId: enrollment.cadence_id,
    currentStep: enrollment.current_step,
    stepChannel: step?.channel ?? null,
  };
}

/**
 * Find user_id by API4COM ramal (extension number).
 */
export async function findUserByExtension(
  supabase: SupabaseClient,
  ramal: string,
): Promise<{ userId: string; orgId: string } | null> {
  const { data } = (await from(supabase, 'api4com_connections' as never)
    .select('user_id, org_id')
    .eq('ramal', ramal)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { user_id: string; org_id: string } | null };

  return data ? { userId: data.user_id, orgId: data.org_id } : null;
}

/**
 * Create an interaction record for an external call.
 */
export async function createExternalCallInteraction(
  supabase: SupabaseClient,
  opts: {
    orgId: string;
    leadId: string;
    userId: string;
    duration: number;
    api4comId: string;
    status: string;
    recordingUrl?: string | null;
  },
): Promise<void> {
  const durationFormatted = opts.duration > 0
    ? `${Math.floor(opts.duration / 60)}min ${opts.duration % 60}s`
    : '0s';

  await from(supabase, 'interactions')
    .insert({
      org_id: opts.orgId,
      lead_id: opts.leadId,
      type: 'sent',
      channel: 'phone',
      message_content: `Ligação externa (${durationFormatted}) — ${opts.status}`,
      metadata: {
        source: 'external_api4com',
        api4com_id: opts.api4comId,
        duration: opts.duration,
        status: opts.status,
        recording_url: opts.recordingUrl ?? null,
      },
      performed_by: opts.userId,
    } as Record<string, unknown>);
}

/**
 * Advance cadence enrollment to next step if current step is phone.
 */
export async function advanceExternalCallCadence(
  supabase: SupabaseClient,
  enrollment: { enrollmentId: string; cadenceId: string; currentStep: number },
): Promise<void> {
  // Find next step
  const { data: nextStep } = (await from(supabase, 'cadence_steps')
    .select('step_order')
    .eq('cadence_id', enrollment.cadenceId)
    .gt('step_order', enrollment.currentStep)
    .order('step_order', { ascending: true })
    .limit(1)
    .maybeSingle()) as { data: { step_order: number } | null };

  if (nextStep) {
    // Advance to next step
    await from(supabase, 'cadence_enrollments')
      .update({
        current_step: nextStep.step_order,
        next_step_due: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', enrollment.enrollmentId);
  } else {
    // No more steps — complete enrollment
    await from(supabase, 'cadence_enrollments')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      } as Record<string, unknown>)
      .eq('id', enrollment.enrollmentId);
  }
}
