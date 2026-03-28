'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { handleQueryError } from '@/lib/actions/handle-error';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { sanitizeFilterValue } from '@/lib/supabase/sanitize-filter';

import type { EnrollmentListResult, EnrollmentWithLead } from '../cadences.contract';
import type { EnrollmentStatus } from '../types';

export async function fetchCadenceEnrollments(
  cadenceId: string,
  page = 1,
  perPage = 50,
): Promise<ActionResult<EnrollmentListResult>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Verify cadence belongs to org
  const { data: cadence } = (await from(supabase, 'cadences')
    .select('id')
    .eq('id', cadenceId)
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .single()) as { data: { id: string } | null };

  if (!cadence) {
    return { success: false, error: 'Cadência não encontrada' };
  }

  const rangeFrom = (page - 1) * perPage;
  const to = rangeFrom + perPage - 1;

  const { data, count, error } = (await from(supabase, 'cadence_enrollments')
    .select('*, leads!inner(razao_social, nome_fantasia, cnpj)', { count: 'exact' })
    .eq('cadence_id', cadenceId)
    .order('enrolled_at', { ascending: false })
    .range(rangeFrom, to)) as {
    data: Array<Record<string, unknown> & { leads: { razao_social: string | null; nome_fantasia: string | null; cnpj: string } }> | null;
    count: number | null;
    error: { message: string } | null;
  };

  const qErr = handleQueryError(error, 'Erro ao buscar inscritos', 'enrollments');
  if (qErr) return qErr;

  const enrollments: EnrollmentWithLead[] = (data ?? []).map((row) => {
    const { leads, ...enrollment } = row;
    return {
      ...enrollment,
      lead_name: leads.nome_fantasia ?? leads.razao_social,
      lead_cnpj: leads.cnpj,
    } as EnrollmentWithLead;
  });

  return {
    success: true,
    data: {
      data: enrollments,
      total: count ?? 0,
    },
  };
}

export async function fetchAvailableLeads(
  cadenceId: string,
  search?: string,
  limit = 20,
): Promise<ActionResult<Array<{ id: string; name: string; cnpj: string; email: string | null }>>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  // Get leads already enrolled in this cadence
  const { data: enrolled } = (await from(supabase, 'cadence_enrollments')
    .select('lead_id')
    .eq('cadence_id', cadenceId)) as { data: Array<{ lead_id: string }> | null };

  const enrolledIds = (enrolled ?? []).map((e) => e.lead_id);

  // Get available leads
  let query = from(supabase, 'leads')
    .select('id, razao_social, nome_fantasia, cnpj, email')
    .eq('org_id', orgId)
    .is('deleted_at', null)
    .neq('status', 'archived')
    .limit(limit);

  if (enrolledIds.length > 0) {
    // Filter out already enrolled leads
    query = query.not('id', 'in', `(${enrolledIds.join(',')})`);
  }

  if (search && search.trim()) {
    const safe = sanitizeFilterValue(search);
    query = query.or(`razao_social.ilike.%${safe}%,nome_fantasia.ilike.%${safe}%,cnpj.ilike.%${safe}%`);
  }

  const { data, error } = (await query) as {
    data: Array<{ id: string; razao_social: string | null; nome_fantasia: string | null; cnpj: string; email: string | null }> | null;
    error: { message: string } | null;
  };

  const qErr2 = handleQueryError(error, 'Erro ao buscar leads disponíveis', 'enrollments');
  if (qErr2) return qErr2;

  return {
    success: true,
    data: (data ?? []).map((lead) => ({
      id: lead.id,
      name: lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj,
      cnpj: lead.cnpj,
      email: lead.email,
    })),
  };
}

export async function updateEnrollmentStatus(
  enrollmentId: string,
  status: EnrollmentStatus,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { error } = await from(supabase, 'cadence_enrollments')
    .update({ status } as Record<string, unknown>)
    .eq('id', enrollmentId);

  const qErr3 = handleQueryError(error, 'Erro ao atualizar status do enrollment', 'enrollments');
  if (qErr3) return qErr3;

  revalidatePath('/cadences');
  return { success: true, data: undefined };
}

export async function removeEnrollment(
  enrollmentId: string,
): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase } = auth.data;

  const { error } = await from(supabase, 'cadence_enrollments')
    .delete()
    .eq('id', enrollmentId);

  const qErr4 = handleQueryError(error, 'Erro ao remover enrollment', 'enrollments');
  if (qErr4) return qErr4;

  revalidatePath('/cadences');
  return { success: true, data: undefined };
}
