'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { DrilldownResult } from '@/shared/components/drilldown/drilldown.types';
import { fetchDrilldownInputSchema, type FetchDrilldownInput } from '@/shared/schemas/drilldown.schema';

const PAGE_SIZE = 25;

/** Convert a YYYY-MM-DD date string to BRT start-of-day (03:00:00Z) as ISO. */
function toIso(dateStr: string): string {
  return `${dateStr}T03:00:00.000Z`;
}

/** Convert a YYYY-MM-DD date string to BRT end-of-day (next day 02:59:59.999Z) as ISO. */
function toIsoEnd(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const nextDay = new Date(Date.UTC(year!, month! - 1, day! + 1, 2, 59, 59, 999));
  return nextDay.toISOString();
}

function todayRange(): { start: string; end: string } {
  // Get today's date in BRT (UTC-3)
  const nowBrt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const today = nowBrt.toISOString().split('T')[0] ?? '';
  return { start: toIso(today), end: toIsoEnd(today) };
}

export async function fetchDrilldownData(
  input: FetchDrilldownInput,
): Promise<ActionResult<DrilldownResult>> {
  const parsed = fetchDrilldownInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: 'Parâmetros inválidos' };
  }

  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  try {
    const { metric, filters, page } = parsed.data;
    const offset = (page - 1) * PAGE_SIZE;
    const rangeStart = offset;
    const rangeEnd = offset + PAGE_SIZE - 1;
    const fromDate = toIso(filters.from);
    const toDate = toIsoEnd(filters.to);

    switch (metric) {
      case 'overall_contacted':
      case 'overall_replied':
      case 'overall_meetings': {
        const typeMap: Record<string, string[]> = {
          overall_contacted: ['sent'],
          overall_replied: ['replied'],
          overall_meetings: ['meeting_scheduled'],
        };
        const types = typeMap[metric] ?? [];

        const { data, count } = (await from(supabase, 'interactions')
          .select('id, type, created_at, lead_id, cadence_id, leads!inner(id, razao_social, nome_fantasia, email), cadences(id, name)', { count: 'exact' })
          .eq('org_id', orgId)
          .in('type', types)
          .gte('created_at', fromDate)
          .lte('created_at', toDate)
          .order('created_at', { ascending: false })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.leads?.id,
              razaoSocial: row.leads?.razao_social ?? '—',
              nomeFantasia: row.leads?.nome_fantasia ?? '—',
              email: row.leads?.email ?? '—',
              type: row.type,
              cadenceName: row.cadences?.name ?? '—',
              createdAt: new Date(row.created_at).toLocaleDateString('pt-BR'),
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'overall_leads': {
        // 2-step: get distinct lead_ids from interactions+enrollments, then paginate leads
        const { data: interactionLeads } = (await from(supabase, 'interactions')
          .select('lead_id')
          .eq('org_id', orgId)
          .gte('created_at', fromDate)
          .lte('created_at', toDate)) as { data: { lead_id: string }[] | null };

        // cadence_enrollments has no org_id — scope via org cadences
        const { data: drillCadences } = (await from(supabase, 'cadences').select('id').eq('org_id', orgId).is('deleted_at', null)) as { data: { id: string }[] | null };
        const drillCadenceIds = (drillCadences ?? []).map((c) => c.id);
        const { data: enrollmentLeads } = (await from(supabase, 'cadence_enrollments')
          .select('lead_id')
          .in('cadence_id', drillCadenceIds.length > 0 ? drillCadenceIds : ['__none__'])
          .gte('created_at', fromDate)
          .lte('created_at', toDate)) as { data: { lead_id: string }[] | null };

        const leadIds = [
          ...new Set([
            ...(interactionLeads ?? []).map((r) => r.lead_id),
            ...(enrollmentLeads ?? []).map((r) => r.lead_id),
          ]),
        ];

        if (leadIds.length === 0) {
          return { success: true, data: { data: [], total: 0, page } };
        }

        const { data, count } = (await from(supabase, 'leads')
          .select('id, razao_social, nome_fantasia, email, status', { count: 'exact' })
          .eq('org_id', orgId)
          .in('id', leadIds)
          .order('razao_social', { ascending: true })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.id,
              razaoSocial: row.razao_social ?? '—',
              nomeFantasia: row.nome_fantasia ?? '—',
              email: row.email ?? '—',
              status: row.status,
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'overall_qualified': {
        const { data, count } = (await from(supabase, 'leads')
          .select('id, razao_social, nome_fantasia, email, status, won_at', { count: 'exact' })
          .eq('org_id', orgId)
          .eq('status', 'won')
          .not('won_at', 'is', null)
          .gte('won_at', fromDate)
          .lte('won_at', toDate)
          .order('won_at', { ascending: false })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.id,
              razaoSocial: row.razao_social ?? '—',
              nomeFantasia: row.nome_fantasia ?? '—',
              email: row.email ?? '—',
              status: row.status,
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'cadence_enrollments': {
        // cadence_enrollments has no org_id — scope via org cadences
        const { data: enrCadences } = (await from(supabase, 'cadences').select('id').eq('org_id', orgId).is('deleted_at', null)) as { data: { id: string }[] | null };
        const enrCadenceIds = (enrCadences ?? []).map((c) => c.id);
        let query = from(supabase, 'cadence_enrollments')
          .select('id, status, created_at, leads!inner(id, razao_social, nome_fantasia, email)', { count: 'exact' })
          .in('cadence_id', enrCadenceIds.length > 0 ? enrCadenceIds : ['__none__'])
          .gte('created_at', fromDate)
          .lte('created_at', toDate);

        if (filters.cadenceId) {
          query = query.eq('cadence_id', filters.cadenceId);
        }

        const { data, count } = (await query
          .order('created_at', { ascending: false })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.leads?.id,
              razaoSocial: row.leads?.razao_social ?? '—',
              nomeFantasia: row.leads?.nome_fantasia ?? '—',
              email: row.leads?.email ?? '—',
              status: row.status,
              enrolledAt: new Date(row.created_at).toLocaleDateString('pt-BR'),
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'sdr_activities': {
        let query = from(supabase, 'interactions')
          .select('id, type, created_at, lead_id, cadence_id, leads!inner(id, razao_social, nome_fantasia, email), cadences(id, name)', { count: 'exact' })
          .eq('org_id', orgId)
          .gte('created_at', fromDate)
          .lte('created_at', toDate);

        if (filters.sdrId) {
          query = query.eq('performed_by', filters.sdrId);
        }

        const { data, count } = (await query
          .order('created_at', { ascending: false })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.leads?.id,
              razaoSocial: row.leads?.razao_social ?? '—',
              nomeFantasia: row.leads?.nome_fantasia ?? '—',
              email: row.leads?.email ?? '—',
              type: row.type,
              cadenceName: row.cadences?.name ?? '—',
              createdAt: new Date(row.created_at).toLocaleDateString('pt-BR'),
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'activity_total':
      case 'activity_today': {
        const dateRange = metric === 'activity_today'
          ? todayRange()
          : { start: fromDate, end: toDate };

        const { data, count } = (await from(supabase, 'interactions')
          .select('id, type, created_at, lead_id, cadence_id, leads!inner(id, razao_social, nome_fantasia, email), cadences(id, name)', { count: 'exact' })
          .eq('org_id', orgId)
          .gte('created_at', dateRange.start)
          .lte('created_at', dateRange.end)
          .order('created_at', { ascending: false })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.leads?.id,
              razaoSocial: row.leads?.razao_social ?? '—',
              nomeFantasia: row.leads?.nome_fantasia ?? '—',
              email: row.leads?.email ?? '—',
              type: row.type,
              cadenceName: row.cadences?.name ?? '—',
              createdAt: new Date(row.created_at).toLocaleDateString('pt-BR'),
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      case 'conversion_stage': {
        const stage = filters.stage ?? 'new';

        const { data, count } = (await from(supabase, 'leads')
          .select('id, razao_social, nome_fantasia, email, status', { count: 'exact' })
          .eq('org_id', orgId)
          .eq('status', stage)
          .order('razao_social', { ascending: true })
          .range(rangeStart, rangeEnd)) as { data: any[] | null; count: number | null };

        return {
          success: true,
          data: {
            data: (data ?? []).map((row: any) => ({
              id: row.id,
              leadId: row.id,
              razaoSocial: row.razao_social ?? '—',
              nomeFantasia: row.nome_fantasia ?? '—',
              email: row.email ?? '—',
              status: row.status,
            })),
            total: count ?? 0,
            page,
          },
        };
      }

      default:
        return { success: false, error: `Métrica desconhecida: ${metric}` };
    }
  } catch (error) {
    console.error('Drilldown fetch error:', error);
    return { success: false, error: 'Erro ao buscar dados detalhados' };
  }
}
