'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { CadenceStepRow, MessageTemplateRow } from '@/features/cadences/types';
import type { EnrichmentStatus, LeadAddress, LeadEmail, LeadPhone, LeadSocio, LeadStatus } from '@/features/leads/types';

import type { PendingActivity } from '../types';
import { OVERDUE_THRESHOLD_HOURS, hoursOverdue } from '../utils/overdue';

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
  meeting_scheduled_at: string | null;
  enrichment_status: EnrichmentStatus | null;
  notes: string | null;
  fit_score: number | null;
  engagement_score: number | null;
  is_inbound: boolean;
  created_at: string;
  phones: LeadPhone[] | null;
  emails: LeadEmail[] | null;
  job_title: string | null;
  lead_source: string | null;
  canal: string | null;
  segmento: string | null;
  assigned_to: string | null;
  custom_field_values: Record<string, string> | null;
}

interface EnrollmentRow {
  id: string;
  cadence_id: string;
  lead_id: string;
  current_step: number;
  status: string;
  next_step_due: string | null;
  lead: RawLead;
  cadence: { id: string; name: string; total_steps: number; created_by: string | null };
}

export interface ActivityLogResult {
  activities: PendingActivity[];
  total: number;
}

/**
 * Fetch ALL activities for the activity log view (not just due/pending).
 * This includes all active enrollments regardless of when they're due.
 */
export async function fetchActivityLog(
  rawFilters: Record<string, unknown>,
): Promise<ActionResult<ActivityLogResult>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const channel = typeof rawFilters.channel === 'string' ? rawFilters.channel : undefined;
  const status = typeof rawFilters.status === 'string' ? rawFilters.status : undefined;
  const search = typeof rawFilters.search === 'string' ? rawFilters.search : undefined;
  const page = typeof rawFilters.page === 'number' ? rawFilters.page : (typeof rawFilters.page === 'string' ? parseInt(rawFilters.page, 10) : 1);
  const perPage = typeof rawFilters.per_page === 'number' ? rawFilters.per_page : (typeof rawFilters.per_page === 'string' ? parseInt(rawFilters.per_page, 10) : 50);
  const rangeFrom = (page - 1) * perPage;

  // Fetch active enrollments with pagination
  let query = from(supabase, 'cadence_enrollments')
    .select('id, cadence_id, lead_id, current_step, status, next_step_due, lead:leads(*), cadence:cadences(id, name, total_steps, created_by)', { count: 'exact' })
    .eq('status', 'active')
    .not('next_step_due', 'is', null)
    .order('next_step_due', { ascending: true })
    .range(rangeFrom, rangeFrom + perPage - 1);

  const { data: enrollments, count, error: enrollError } = (await query) as {
    data: EnrollmentRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  const qErr = handleQueryError(enrollError, 'Erro ao buscar atividades', 'activity-log');
  if (qErr) return qErr;

  if (!enrollments || enrollments.length === 0) {
    return { success: true, data: { activities: [], total: 0 } };
  }

  // Batch-fetch steps + templates
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

  // Build lookup maps
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

  // Map to PendingActivity[] and apply client-side filters
  const activities: PendingActivity[] = [];

  for (const enrollment of enrollments) {
    if (!enrollment.lead || !enrollment.cadence || !enrollment.next_step_due) continue;

    const cadenceSteps = stepMap.get(enrollment.cadence_id) ?? [];
    const currentStep = cadenceSteps.find((s) => s.step_order === enrollment.current_step);

    if (!currentStep) continue;

    // Channel filter
    if (channel && channel !== 'all' && currentStep.channel !== channel) continue;

    // Status filter (overdue = >= threshold, due = < threshold).
    // Usa horas comerciais — atividade que venceu fora do expediente só
    // começa a contar a partir das 9h do próximo dia útil.
    if (status) {
      const diffH = hoursOverdue(enrollment.next_step_due);
      if (status === 'overdue' && diffH < OVERDUE_THRESHOLD_HOURS) continue;
      if (status === 'due' && diffH >= OVERDUE_THRESHOLD_HOURS) continue;
    }

    const template = currentStep.template_id ? templateMap.get(currentStep.template_id) : null;

    const activity: PendingActivity = {
      enrollmentId: enrollment.id,
      cadenceId: enrollment.cadence_id,
      cadenceName: enrollment.cadence.name,
      cadenceCreatedBy: enrollment.cadence.created_by,
      stepId: currentStep.id,
      stepOrder: currentStep.step_order,
      totalSteps: enrollment.cadence.total_steps,
      channel: currentStep.channel,
      templateId: currentStep.template_id,
      templateSubject: template?.subject ?? null,
      templateBody: template?.body ?? null,
      aiPersonalization: currentStep.ai_personalization,
      nextStepDue: enrollment.next_step_due,
      isCurrentStep: true,
      lead: {
        ...enrollment.lead,
        primeiro_nome: enrollment.lead.socios?.[0]?.nome?.trim().split(/\s+/)[0] ?? null,
        phones: enrollment.lead.phones ?? null,
        emails: enrollment.lead.emails ?? null,
        job_title: enrollment.lead.job_title ?? null,
        lead_source: enrollment.lead.lead_source ?? null,
        canal: enrollment.lead.canal ?? null,
        segmento: enrollment.lead.segmento ?? null,
        assigned_to: enrollment.lead.assigned_to ?? null,
        custom_field_values: enrollment.lead.custom_field_values ?? null,
      },
      activityName: currentStep.activity_name ?? null,
      callScript: currentStep.instructions ?? null,
    };

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      const leadName = (activity.lead.nome_fantasia ?? activity.lead.razao_social ?? activity.lead.cnpj).toLowerCase();
      const cadence = activity.cadenceName.toLowerCase();
      const leadEmail = (activity.lead.email ?? '').toLowerCase();
      const leadPhone = (activity.lead.telefone ?? '').toLowerCase();
      if (!leadName.includes(q) && !cadence.includes(q) && !leadEmail.includes(q) && !leadPhone.includes(q)) continue;
    }

    activities.push(activity);
  }

  return {
    success: true,
    data: {
      activities,
      total: count ?? 0,
    },
  };
}
