'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CadenceRow, CadenceStepRow, MessageTemplateRow } from '@/features/cadences/types';
import type { EnrichmentStatus, LeadAddress, LeadSocio, LeadStatus } from '@/features/leads/types';

import type { PendingActivity } from '../types';

interface RawLead {
  id: string;
  org_id: string;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string;
  email: string | null;
  telefone: string | null;
  municipio: string | null;
  uf: string | null;
  porte: string | null;
  first_name: string | null;
  last_name: string | null;
  socios: LeadSocio[] | null;
  endereco: LeadAddress | null;
  instagram: string | null;
  linkedin: string | null;
  website: string | null;
  status: LeadStatus | null;
  enrichment_status: EnrichmentStatus | null;
  notes: string | null;
  fit_score: number | null;
  engagement_score: number | null;
  is_inbound: boolean;
  created_at: string;
}

interface EnrollmentRow {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  status: string;
  next_step_due: string | null;
  lead: RawLead;
  cadence: Pick<CadenceRow, 'id' | 'name' | 'total_steps' | 'created_by' | 'type'>;
}

export async function fetchPendingActivities(): Promise<ActionResult<PendingActivity[]>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  // 1. Fetch ALL active enrollments with due steps (no time window — show everything pending)
  // RLS on leads table filters by assigned_to for SDRs: leads not visible to this
  // user will come back as null in the join, and are filtered out below.
  const { data: enrollments, error: enrollError } = (await from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, status, next_step_due, lead:leads!inner(*), cadence:cadences(id, name, total_steps, created_by, type)')
    .eq('status', 'active')
    .not('next_step_due', 'is', null)
    .order('enrolled_at', { ascending: false })
    .limit(500)) as { data: EnrollmentRow[] | null; error: { message: string } | null };

  const qErr = handleQueryError(enrollError, 'Erro ao buscar atividades pendentes', 'activities');
  if (qErr) return qErr;

  if (!enrollments || enrollments.length === 0) {
    return { success: true, data: [] };
  }

  // 2. Collect unique cadence IDs and batch-fetch steps + templates
  const cadenceIds = [...new Set(enrollments.map((e) => e.cadence_id))];

  const { data: steps } = (await from(supabase, 'cadence_steps')
    .select('*')
    .in('cadence_id', cadenceIds)) as { data: CadenceStepRow[] | null };

  const templateIds = (steps ?? [])
    .map((s) => s.template_id)
    .filter((id): id is string => id != null);

  let templates: MessageTemplateRow[] = [];
  if (templateIds.length > 0) {
    const { data: tplData } = (await from(supabase, 'message_templates')
      .select('*')
      .in('id', templateIds)) as { data: MessageTemplateRow[] | null };
    templates = tplData ?? [];
  }

  // 3. Build lookup maps
  const stepMap = new Map<string, CadenceStepRow[]>();
  for (const s of steps ?? []) {
    const list = stepMap.get(s.cadence_id) ?? [];
    list.push(s);
    stepMap.set(s.cadence_id, list);
  }

  const templateMap = new Map<string, MessageTemplateRow>();
  for (const t of templates) {
    templateMap.set(t.id, t);
  }

  // 4. Build candidate activities (before filtering executed ones)
  // For each enrollment, generate activities for ALL steps within 24h cumulative delay
  interface CandidateActivity {
    activity: PendingActivity;
    cadenceId: string;
    stepId: string;
    leadId: string;
  }
  const candidates: CandidateActivity[] = [];

  for (const enrollment of enrollments) {
    if (!enrollment.lead || !enrollment.cadence || !enrollment.next_step_due) continue;

    // Skip auto_email cadences — they are managed via background job, not the manual queue
    if (enrollment.cadence.type === 'auto_email') continue;

    const cadenceSteps = (stepMap.get(enrollment.cadence_id) ?? [])
      .slice()
      .sort((a, b) => a.step_order - b.step_order);

    const currentStepOrder = enrollment.current_step;

    // Build lead data once per enrollment
    const leadData = {
      ...enrollment.lead,
      primeiro_nome: enrollment.lead.first_name
        ?? enrollment.lead.socios?.[0]?.nome?.trim().split(/\s+/)[0]
        ?? null,
    };

    let cumulativeHours = 0;

    for (const step of cadenceSteps) {
      if (step.step_order < currentStepOrder) continue;

      // Accumulate delay for steps beyond the current one
      if (step.step_order > currentStepOrder) {
        cumulativeHours += step.delay_days * 24 + step.delay_hours;
      }

      // Stop if cumulative delay exceeds 24h
      if (cumulativeHours > 24) break;

      const isCurrentStep = step.step_order === currentStepOrder;
      const template = step.template_id ? templateMap.get(step.template_id) : null;

      // Calculate actual due date for future steps based on cumulative delay
      let stepDueDate = enrollment.next_step_due;
      if (!isCurrentStep && enrollment.next_step_due) {
        const baseDue = new Date(enrollment.next_step_due);
        baseDue.setHours(baseDue.getHours() + cumulativeHours);
        stepDueDate = baseDue.toISOString();
      }

      candidates.push({
        cadenceId: enrollment.cadence_id,
        stepId: step.id,
        leadId: enrollment.lead_id,
        activity: {
          enrollmentId: enrollment.id,
          cadenceId: enrollment.cadence_id,
          cadenceName: enrollment.cadence.name,
          cadenceCreatedBy: enrollment.cadence.created_by,
          stepId: step.id,
          stepOrder: step.step_order,
          totalSteps: enrollment.cadence.total_steps,
          channel: step.channel,
          templateId: step.template_id,
          templateSubject: template?.subject ?? null,
          templateBody: template?.body ?? null,
          aiPersonalization: step.ai_personalization,
          nextStepDue: stepDueDate,
          isCurrentStep,
          lead: leadData,
          activityName: step.activity_name ?? null,
          callScript: step.instructions ?? null,
        },
      });
    }
  }

  if (candidates.length === 0) {
    return { success: true, data: [] };
  }

  // 5. Filter out activities already executed (using optimized SQL function with composite index)
  const stepIds = [...new Set(candidates.map((c) => c.stepId))];
  const leadIds = [...new Set(candidates.map((c) => c.leadId))];

  const { data: executedSteps } = await (supabase.rpc as any)('get_executed_steps', {
    p_cadence_ids: cadenceIds,
    p_step_ids: stepIds,
    p_lead_ids: leadIds,
  }) as { data: { cadence_id: string; step_id: string; lead_id: string }[] | null };

  const executedSet = new Set(
    (executedSteps ?? []).map((i) => `${i.cadence_id}:${i.step_id}:${i.lead_id}`),
  );

  const cadenceActivities = candidates
    .filter((c) => !executedSet.has(`${c.cadenceId}:${c.stepId}:${c.leadId}`))
    .map((c) => c.activity);

  // 6. Fetch pending scheduled activities (standalone return-to-lead activities)
  const { data: scheduledRows } = (await from(supabase, 'scheduled_activities' as never)
    .select('id, lead_id, channel, scheduled_at, notes, leads!inner(id, org_id, nome_fantasia, razao_social, cnpj, email, telefone, municipio, uf, porte, first_name, last_name, socios, endereco, instagram, linkedin, website, status, enrichment_status, notes, fit_score, engagement_score)')
    .eq('status', 'pending')
    .order('scheduled_at', { ascending: true })
    .limit(100)) as { data: Array<{
      id: string;
      lead_id: string;
      channel: string;
      scheduled_at: string;
      notes: string | null;
      leads: RawLead;
    }> | null };

  const scheduledActivities: PendingActivity[] = (scheduledRows ?? []).map((row) => ({
    enrollmentId: `scheduled:${row.id}`,
    cadenceId: '',
    cadenceName: 'Atividade Agendada',
    cadenceCreatedBy: null,
    stepId: row.id,
    stepOrder: 1,
    totalSteps: 1,
    channel: row.channel as PendingActivity['channel'],
    templateId: null,
    templateSubject: null,
    templateBody: null,
    aiPersonalization: false,
    nextStepDue: row.scheduled_at,
    isCurrentStep: true,
    lead: {
      ...row.leads,
      primeiro_nome: row.leads.first_name
        ?? row.leads.socios?.[0]?.nome?.trim().split(/\s+/)[0]
        ?? null,
    },
    activityName: row.notes ? `Retorno: ${row.notes}` : 'Retorno agendado',
    callScript: row.notes,
  }));

  // 7. Merge and sort: group by lead so SDR finishes all steps for one lead before moving to the next
  // Example: Pesquisa Lead A → Ligação Lead A → Pesquisa Lead B → Ligação Lead B
  const allActivities = [...cadenceActivities, ...scheduledActivities];

  // Build a map of earliest due date per lead (for ordering leads)
  const leadEarliestDue = new Map<string, number>();
  for (const a of allActivities) {
    const due = new Date(a.nextStepDue).getTime();
    const current = leadEarliestDue.get(a.lead.id);
    if (current === undefined || due < current) {
      leadEarliestDue.set(a.lead.id, due);
    }
  }

  const activities = allActivities.sort((a, b) => {
    // Priority 1: Inbound leads first (they need immediate attention)
    const aInbound = a.lead.is_inbound ? 1 : 0;
    const bInbound = b.lead.is_inbound ? 1 : 0;
    if (aInbound !== bInbound) return bInbound - aInbound;

    // Priority 2: Group by lead, order leads by earliest due date
    if (a.lead.id !== b.lead.id) {
      const aDue = leadEarliestDue.get(a.lead.id) ?? 0;
      const bDue = leadEarliestDue.get(b.lead.id) ?? 0;
      return aDue - bDue;
    }
    // Within same lead: current steps first, then by step order
    if (a.isCurrentStep !== b.isCurrentStep) return a.isCurrentStep ? -1 : 1;
    return a.stepOrder - b.stepOrder;
  });

  return { success: true, data: activities };
}
