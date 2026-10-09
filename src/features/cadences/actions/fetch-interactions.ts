'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';

import type { TimelineEntry, CadenceMetrics } from '../cadences.contract';
import type { CadenceEnrollmentRow, InteractionRow } from '../types';

/**
 * Eventos de ciclo de vida da cadência (inscrição e saída). Sempre incluídos no
 * timeline mesmo que empurrados para além das `limit` interações recentes — em
 * leads com muitas ligações o motivo de saída ("por que saiu da cadência")
 * ficava fora da janela das 50 mais recentes e sumia.
 */
const CADENCE_LIFECYCLE_EVENTS = [
  'cadence_enrolled',
  'enrollment_added',
  'cadence_switched',
  'cadence_ignored',
  'cadence_completed',
  'cadence_paused',
  'cadence_paused_for_return',
  'cadence_resumed',
  'enrollment_removed',
  'cadence_limbo_triaged',
  'prospection_scheduled',
  'prospection_reactivated',
  'inbound_recovery_scheduled',
] as const;

export async function fetchLeadTimeline(
  leadId: string,
  limit = 50,
): Promise<ActionResult<TimelineEntry[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Round 1 (parallel): recent interactions + cadence lifecycle events. The
  // lifecycle ones are always included, even outside the recent window, and
  // merged (dedup by id) — so the "cadence story" never goes missing.
  const [{ data: recent, error }, { data: lifecycle }] = await Promise.all([
    from(supabase, 'interactions')
      .select('*')
      .eq('lead_id', leadId)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(limit) as unknown as Promise<{ data: InteractionRow[] | null; error: { message: string } | null }>,
    from(supabase, 'interactions')
      .select('*')
      .eq('lead_id', leadId)
      .eq('org_id', orgId)
      .filter('metadata->>system_event', 'in', `(${CADENCE_LIFECYCLE_EVENTS.join(',')})`)
      .order('created_at', { ascending: false })
      .limit(50) as unknown as Promise<{ data: InteractionRow[] | null }>,
  ]);

  if (error) {
    return { success: false, error: 'Erro ao buscar interações' };
  }

  const byId = new Map<string, InteractionRow>();
  for (const row of [...(recent ?? []), ...(lifecycle ?? [])]) byId.set(row.id, row);
  const interactions = [...byId.values()].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  const cadenceIds = [...new Set(interactions.map((i) => i.cadence_id).filter((id): id is string => id != null))];
  const stepIds = [...new Set(interactions.map((i) => i.step_id).filter((id): id is string => id != null))];
  const performerIds = [...new Set(
    interactions.map((i) => i.performed_by as string | null).filter((id): id is string => id != null),
  )];
  // Phone interactions carry the call id (recording + transcription)
  const callIds = interactions
    .map((i) => (i.metadata as Record<string, unknown> | null)?.callId as string | undefined)
    .filter((id): id is string => !!id);

  type StepInfo = { id: string; step_order: number; activity_name: string | null; instructions: string | null };
  type CallInfo = { id: string; recording_url: string | null; transcription: string | null; duration_seconds: number };

  // Round 2 (parallel): everything that only depends on the interactions above
  // (used to be four more round trips in series).
  const [cadences, steps, profiles, calls] = await Promise.all([
    cadenceIds.length > 0
      ? (from(supabase, 'cadences').select('id, name').in('id', cadenceIds) as unknown as Promise<{
          data: { id: string; name: string }[] | null;
        }>).then((r) => r.data ?? [])
      : Promise.resolve([] as { id: string; name: string }[]),
    stepIds.length > 0
      ? (from(supabase, 'cadence_steps')
          .select('id, step_order, activity_name, instructions')
          .in('id', stepIds) as unknown as Promise<{ data: StepInfo[] | null }>).then((r) => r.data ?? [])
      : Promise.resolve([] as StepInfo[]),
    resolveUserProfiles(performerIds),
    callIds.length > 0
      ? (from(supabase, 'calls')
          .select('id, recording_url, transcription, duration_seconds')
          .in('id', callIds) as unknown as Promise<{ data: CallInfo[] | null }>).then((r) => r.data ?? [])
      : Promise.resolve([] as CallInfo[]),
  ]);

  const cadenceMap: Record<string, string> = Object.fromEntries(cadences.map((c) => [c.id, c.name]));
  const stepMap: Record<string, { step_order: number; activity_name: string | null; instructions: string | null }> =
    Object.fromEntries(
      steps.map((s) => [s.id, { step_order: s.step_order, activity_name: s.activity_name, instructions: s.instructions }]),
    );
  const userNameMap = new Map([...profiles].map(([id, p]) => [id, p.displayName]));
  const callDataMap = new Map(calls.map((c) => [c.id, c]));

  const timeline: TimelineEntry[] = interactions.map((i) => {
    const meta = i.metadata as Record<string, unknown> | null;
    const stepData = i.step_id ? stepMap[i.step_id] : undefined;
    const performedBy = i.performed_by as string | null;
    const callId = meta?.callId as string | undefined;
    const callData = callId ? callDataMap.get(callId) : undefined;
    return {
      id: i.id,
      type: i.type,
      channel: i.channel,
      message_content: i.message_content,
      subject: (meta?.subject as string) ?? null,
      html_body: (meta?.html_body as string) ?? null,
      ai_generated: i.ai_generated,
      is_note: (meta?.is_note as boolean) ?? false,
      created_at: i.created_at,
      cadence_name: i.cadence_id ? cadenceMap[i.cadence_id] : undefined,
      step_order: stepData?.step_order,
      step_activity_name: stepData?.activity_name ?? undefined,
      step_instructions: stepData?.instructions ?? undefined,
      metadata: meta,
      performed_by_name: performedBy ? userNameMap.get(performedBy) : undefined,
      call_id: callId ?? null,
      recording_url: callData?.recording_url ?? null,
      transcription: callData?.transcription ?? null,
      call_duration: callData?.duration_seconds ?? null,
    };
  });

  return { success: true, data: timeline };
}

export async function fetchCadenceMetrics(
  cadenceId: string,
): Promise<ActionResult<CadenceMetrics>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { data: enrollments } = (await from(supabase, 'cadence_enrollments')
    .select('status')
    .eq('cadence_id', cadenceId)) as { data: Pick<CadenceEnrollmentRow, 'status'>[] | null };

  const all = enrollments ?? [];

  return {
    success: true,
    data: {
      total_enrolled: all.length,
      in_progress: all.filter((e) => e.status === 'active' || e.status === 'paused').length,
      completed: all.filter((e) => e.status === 'completed').length,
      replied: all.filter((e) => e.status === 'replied').length,
      bounced: all.filter((e) => e.status === 'bounced').length,
    },
  };
}
