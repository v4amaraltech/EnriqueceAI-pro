'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';

import { buildLeadCard, type LeadCardModel } from '@/features/cockpit/utils/lead-card';

const LEAD_COLUMNS =
  'id, first_name, last_name, nome_fantasia, razao_social, telefone, phones, job_title, segmento, cnpj, email, socios, lead_source, canal, lost_at, loss_notes, loss_reason_id, created_at, assigned_to';

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  telefone: string | null;
  phones: Array<{ numero?: string | null }> | null;
  job_title: string | null;
  segmento: string | null;
  cnpj: string | null;
  email: string | null;
  socios: Array<{ emails?: Array<{ email?: string | null; ranking?: number }> | null }> | null;
  lead_source: string | null;
  canal: string | null;
  lost_at: string | null;
  loss_notes: string | null;
  loss_reason_id: string | null;
  created_at: string | null;
  assigned_to: string | null;
}

export interface FetchDialerLeadCardInput {
  leadId: string;
  enrollmentId?: string;
  stepOrder: number;
  totalSteps: number;
  callScript: string | null;
}

function resolveEmail(lead: LeadRow): string | null {
  const fromSocios = (lead.socios ?? [])
    .flatMap((socio) => socio.emails ?? [])
    .filter((entry) => entry.email?.trim())
    .sort((a, b) => (a.ranking ?? 99) - (b.ranking ?? 99))[0]?.email;
  return fromSocios?.trim() || lead.email?.trim() || null;
}

/**
 * Contexto do cartão do lead da vez no Power Dialer. Só este lead, para não
 * atrasar o laço de 5 s nem inflar a fila.
 */
export async function fetchDialerLeadCard(
  input: FetchDialerLeadCardInput,
): Promise<ActionResult<LeadCardModel>> {
  if (!isUuid(input.leadId)) return { success: false, error: 'Lead inválido' };
  if (!Number.isFinite(input.stepOrder) || !Number.isFinite(input.totalSteps)) {
    return { success: false, error: 'Dados inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, orgId, userId, role } = auth.data;

  let leadQuery = from(supabase, 'leads')
    .select(LEAD_COLUMNS)
    .eq('id', input.leadId)
    .eq('org_id', orgId)
    .is('deleted_at', null);
  if (role !== 'manager') leadQuery = leadQuery.eq('assigned_to', userId);

  const leadResult = (await leadQuery.maybeSingle()) as {
    data: LeadRow | null;
    error: { message: string } | null;
  };
  if (leadResult.error) return { success: false, error: 'Falha ao carregar o contexto do lead' };
  if (!leadResult.data) return { success: false, error: 'Lead não encontrado' };
  const lead = leadResult.data;

  const enrollmentId = input.enrollmentId && isUuid(input.enrollmentId) ? input.enrollmentId : null;
  const [enrollmentResult, reasonResult, interactionResult] = await Promise.all([
    enrollmentId
      ? (from(supabase, 'cadence_enrollments')
          .select('loss_notes')
          .eq('id', enrollmentId)
          .eq('lead_id', lead.id)
          .maybeSingle() as unknown as Promise<{
          data: { loss_notes: string | null } | null;
          error: { message: string } | null;
        }>)
      : Promise.resolve({ data: null, error: null }),
    lead.loss_reason_id
      ? (from(supabase, 'loss_reasons')
          .select('id, name')
          .eq('id', lead.loss_reason_id)
          .maybeSingle() as unknown as Promise<{
          data: { id: string; name: string } | null;
          error: { message: string } | null;
        }>)
      : Promise.resolve({ data: null, error: null }),
    from(supabase, 'interactions')
      .select('created_at')
      .eq('lead_id', lead.id)
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(1) as unknown as Promise<{
      data: Array<{ created_at: string }> | null;
      error: { message: string } | null;
    }>,
  ]);

  return {
    success: true,
    data: buildLeadCard({
      firstName: lead.first_name,
      lastName: lead.last_name,
      nomeFantasia: lead.nome_fantasia,
      razaoSocial: lead.razao_social,
      telefone: lead.telefone,
      phones: lead.phones,
      jobTitle: lead.job_title,
      segmento: lead.segmento,
      cnpj: lead.cnpj,
      email: resolveEmail(lead),
      leadSource: lead.lead_source,
      canal: lead.canal,
      lostAt: lead.lost_at,
      lossReasonName: reasonResult.data?.name ?? null,
      lossNotes: lead.loss_notes,
      enrollmentLossNotes: enrollmentResult.data?.loss_notes ?? null,
      previousSdrName: null,
      stepOrder: input.stepOrder,
      totalSteps: input.totalSteps,
      lastInteractionAt: interactionResult.data?.[0]?.created_at ?? null,
      createdAt: lead.created_at,
      callScript: input.callScript,
    }),
  };
}
