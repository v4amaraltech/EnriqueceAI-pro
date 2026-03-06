'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { CadenceDetail, CadenceListResult } from '../cadences.contract';
import type { CadenceRow, CadenceStepRow, MessageTemplateRow } from '../types';

interface FetchCadencesParams {
  status?: string;
  search?: string;
  type?: string;
  priority?: string;
  origin?: string;
  page?: number;
  per_page?: number;
}

export interface CadenceTabCounts {
  standard: number;
  auto_email: number;
}

export async function fetchCadences(
  params: FetchCadencesParams = {},
): Promise<ActionResult<CadenceListResult>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const page = params.page ?? 1;
  const per_page = params.per_page ?? 20;
  const from = (page - 1) * per_page;
  const to = from + per_page - 1;

  let query = (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('*', { count: 'exact' })
    .eq('org_id', member.org_id)
    .is('deleted_at', null);

  if (params.status) {
    query = query.eq('status', params.status);
  }

  if (params.type) {
    query = query.eq('type', params.type);
  }

  if (params.priority) {
    query = query.eq('priority', params.priority);
  }

  if (params.origin) {
    query = query.eq('origin', params.origin);
  }

  if (params.search) {
    query = query.ilike('name', `%${params.search}%`);
  }

  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, count, error } = (await query) as {
    data: CadenceRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar cadências' };
  }

  return {
    success: true,
    data: {
      data: data ?? [],
      total: count ?? 0,
      page,
      per_page,
    },
  };
}

export async function fetchCadenceTabCounts(): Promise<ActionResult<CadenceTabCounts>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const baseQuery = (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id', { count: 'exact', head: true })
    .eq('org_id', member.org_id)
    .is('deleted_at', null);

  const [standardResult, autoEmailResult] = await Promise.all([
    baseQuery.eq('type', 'standard') as Promise<{ count: number | null }>,
    (supabase
      .from('cadences') as ReturnType<typeof supabase.from>)
      .select('id', { count: 'exact', head: true })
      .eq('org_id', member.org_id)
      .is('deleted_at', null)
      .eq('type', 'auto_email') as Promise<{ count: number | null }>,
  ]);

  return {
    success: true,
    data: {
      standard: standardResult.count ?? 0,
      auto_email: autoEmailResult.count ?? 0,
    },
  };
}

export async function fetchCadenceDetail(
  cadenceId: string,
): Promise<ActionResult<CadenceDetail>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  // Fetch cadence
  const { data: cadence, error: cadenceError } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('id', cadenceId)
    .eq('org_id', member.org_id)
    .is('deleted_at', null)
    .single()) as { data: CadenceRow | null; error: { message: string } | null };

  if (cadenceError || !cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  // Fetch steps with templates
  const { data: steps } = (await (supabase
    .from('cadence_steps') as ReturnType<typeof supabase.from>)
    .select('*')
    .eq('cadence_id', cadenceId)
    .order('step_order', { ascending: true })) as { data: CadenceStepRow[] | null };

  // Fetch templates for all steps (including variant B)
  const templateIds = (steps ?? [])
    .flatMap((s) => [s.template_id, s.template_id_b])
    .filter((id): id is string => id != null);

  let templatesMap: Record<string, MessageTemplateRow> = {};
  if (templateIds.length > 0) {
    const { data: templates } = (await (supabase
      .from('message_templates') as ReturnType<typeof supabase.from>)
      .select('*')
      .in('id', templateIds)) as { data: MessageTemplateRow[] | null };

    for (const t of templates ?? []) {
      templatesMap[t.id] = t;
    }
  }

  // Count enrollments
  const { count: enrollmentCount } = (await (supabase
    .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
    .select('id', { count: 'exact', head: true })
    .eq('cadence_id', cadenceId)) as { count: number | null };

  const stepsWithTemplates = (steps ?? []).map((step) => ({
    ...step,
    template: step.template_id ? templatesMap[step.template_id] ?? null : null,
    template_b: step.template_id_b ? templatesMap[step.template_id_b] ?? null : null,
  }));

  return {
    success: true,
    data: {
      ...cadence,
      steps: stepsWithTemplates,
      enrollment_count: enrollmentCount ?? 0,
    },
  };
}
