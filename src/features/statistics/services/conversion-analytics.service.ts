import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import { isUuid } from '@/lib/utils/uuid';
import { CONVERSION_COLORS } from '@/shared/constants/chart-colors';

import type {
  CadenceConversionRow,
  ConversionAnalyticsData,
  ConversionByOriginEntry,
  FunnelStage,
  PipelineVelocity,
  StageConversion,
} from '../types/conversion-analytics.types';
import type { EnrollmentQueryRow, LeadQueryRow } from '../types/query-rows';
import { groupBy, safeRate } from '../types/shared';
import { readAllRows } from './read-all-rows';

interface CadenceRow {
  id: string;
  name: string;
}

/**
 * 1 linha por lead do universo, vinda do RPC `get_conversion_universe`
 * (migration `20260911030704`). O banco junta as interações do período em
 * marcadores por lead — antes a tela baixava todas (~58 mil em 90 dias na V4
 * Amaral). Story conversion-analytics-rpc.
 */
export interface ConversionUniverseRow {
  lead_id: string;
  status: string;
  created_by: string | null;
  won_at: string | null;
  has_sent: boolean;
  has_meeting_scheduled: boolean;
  has_replied: boolean;
  /** Inscrições do lead nas cadências consideradas, de qualquer época. */
  enrollments: Array<{
    cadence_id: string;
    enrolled_at: string;
    updated_at: string;
    for_velocity: boolean;
  }>;
}

/** Lead do universo como o cálculo usa. */
export interface UniverseLead {
  id: string;
  status: string;
  created_by: string | null;
  won_at: string | null;
  has_sent: boolean;
  has_meeting_scheduled: boolean;
  has_replied: boolean;
}

/** O RPC roda inteiro a cada página: página do tamanho do teto do servidor (20 mil). */
const UNIVERSE_PAGE_SIZE = 20_000;

export async function fetchConversionAnalyticsData(
  supabase: SupabaseClient,
  orgId: string,
  periodStart: string,
  periodEnd: string,
  userIds?: string[],
  cadenceId?: string,
): Promise<ConversionAnalyticsData> {
  // Universe = leads created in the period ∪ leads touched by any interaction
  // in the period ∪ leads won/lost/meeting held in the period — calculado no
  // banco (org vem da sessão, via RLS). Ver a migration para a regra completa.
  const [rows, { data: rawCadences }] = await Promise.all([
    readAllRows<ConversionUniverseRow>(
      'conversão: universo',
      () =>
        supabase
          .rpc('get_conversion_universe', {
            p_start: periodStart,
            p_end: periodEnd,
            // Filtro ausente = parâmetro omitido (DEFAULT NULL na função).
            ...(userIds && userIds.length > 0 ? { p_user_ids: userIds } : {}),
            ...(isUuid(cadenceId) ? { p_cadence_id: cadenceId } : {}),
          })
          .order('lead_id', { ascending: true }),
      { pageSize: UNIVERSE_PAGE_SIZE },
    ),
    from(supabase, 'cadences')
      .select('id, name')
      .eq('org_id', orgId)
      .is('deleted_at', null) as unknown as Promise<{
      data: CadenceRow[] | null;
    }>,
  ]);

  return buildConversionAnalytics(rows, rawCadences ?? [], periodStart, periodEnd);
}

/** Parte pura: do resultado do RPC aos números da tela. */
export function buildConversionAnalytics(
  rows: ConversionUniverseRow[],
  cadences: CadenceRow[],
  periodStart: string,
  periodEnd: string,
): ConversionAnalyticsData {
  const leads: UniverseLead[] = rows.map((r) => ({
    id: r.lead_id,
    status: r.status,
    created_by: r.created_by,
    won_at: r.won_at,
    has_sent: r.has_sent,
    has_meeting_scheduled: r.has_meeting_scheduled,
    has_replied: r.has_replied,
  }));
  // Vínculo lead↔cadência de qualquer época: um lead inscrito antes do período
  // que qualificou/ganhou dentro dele conta na cadência certa.
  const memberships = rows.flatMap((r) =>
    r.enrollments.map((e) => ({ cadence_id: e.cadence_id, lead_id: r.lead_id })),
  );
  // Velocidade: inscrições que começaram no período (e do SDR filtrado).
  const enrollments = rows.flatMap((r) =>
    r.enrollments
      .filter((e) => e.for_velocity)
      .map((e) => ({ lead_id: r.lead_id, enrolled_at: e.enrolled_at, updated_at: e.updated_at })),
  );

  const funnel = calculateFunnel(leads, periodStart, periodEnd);
  const stageConversions = calculateStageConversions(funnel);
  const velocity = calculateVelocity(enrollments, leads);
  const cadenceConversion = calculateCadenceConversion(cadences, memberships, leads);
  const conversionByOrigin = calculateConversionByOrigin(leads);

  return { funnel, stageConversions, velocity, cadenceConversion, conversionByOrigin };
}

function calculateFunnel(
  leads: UniverseLead[],
  periodStart: string,
  periodEnd: string,
): FunnelStage[] {
  // All stages count events that occurred in the period (not current status),
  // so the funnel reads consistently as "what happened in this period?".
  const totalLeads = leads.length;

  const contactedSet = new Set(leads.filter((l) => l.has_sent).map((l) => l.id));
  const qualifiedSet = new Set(leads.filter((l) => l.has_meeting_scheduled).map((l) => l.id));
  const salSet = new Set(
    leads
      .filter((l) => l.won_at && l.won_at >= periodStart && l.won_at <= periodEnd)
      .map((l) => l.id),
  );

  return [
    {
      label: 'Total Leads',
      count: totalLeads,
      percentage: 100,
      color: CONVERSION_COLORS.totalLeads,
    },
    {
      label: 'Contactados',
      count: contactedSet.size,
      percentage: safeRate(contactedSet.size, totalLeads),
      color: CONVERSION_COLORS.contacted,
    },
    {
      label: 'Qualificados',
      count: qualifiedSet.size,
      percentage: safeRate(qualifiedSet.size, totalLeads),
      color: CONVERSION_COLORS.qualified,
    },
    {
      label: 'SAL',
      count: salSet.size,
      percentage: safeRate(salSet.size, totalLeads),
      color: CONVERSION_COLORS.sal,
    },
  ];
}

function calculateStageConversions(funnel: FunnelStage[]): StageConversion[] {
  const result: StageConversion[] = [];
  for (let i = 0; i < funnel.length - 1; i++) {
    const from = funnel[i]!;
    const to = funnel[i + 1]!;
    result.push({
      from: from.label,
      to: to.label,
      rate: safeRate(to.count, from.count),
      numerator: to.count,
      denominator: from.count,
    });
  }
  return result;
}

export function calculateVelocity(
  enrollments: Array<Pick<EnrollmentQueryRow, 'lead_id' | 'enrolled_at' | 'updated_at'>>,
  leads: Array<Pick<LeadQueryRow, 'id' | 'status'>>,
): PipelineVelocity {
  const qualifiedLeadIds = new Set(
    leads.filter((l) => l.status === 'qualified' || l.status === 'won').map((l) => l.id),
  );

  const durations: number[] = [];
  for (const enrollment of enrollments) {
    if (qualifiedLeadIds.has(enrollment.lead_id)) {
      const startDate = new Date(enrollment.enrolled_at);
      const endDate = new Date(enrollment.updated_at);
      const days = (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000);
      if (days >= 0) durations.push(days);
    }
  }

  if (durations.length === 0) {
    return { avgDaysToQualification: 0, medianDaysToQualification: 0, totalQualified: 0 };
  }

  durations.sort((a, b) => a - b);
  const avg = Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10;
  const mid = Math.floor(durations.length / 2);
  const median =
    durations.length % 2 === 0
      ? Math.round(((durations[mid - 1]! + durations[mid]!) / 2) * 10) / 10
      : Math.round(durations[mid]! * 10) / 10;

  return {
    avgDaysToQualification: avg,
    medianDaysToQualification: median,
    totalQualified: durations.length,
  };
}

function calculateCadenceConversion(
  cadences: CadenceRow[],
  memberships: Array<{ cadence_id: string; lead_id: string }>,
  leads: UniverseLead[],
): CadenceConversionRow[] {
  // All counts are attributed by universe ∩ cadence membership (at any time),
  // so a lead enrolled before the period that became qualified/won during it
  // is still credited to the right cadence. Cumulative buckets keep the
  // invariant Inscritos ≥ Em Contato ≥ Qualificado ≥ Ganho.
  const contactedLeadIds = new Set(
    leads.filter((l) => ['contacted', 'qualified', 'won'].includes(l.status)).map((l) => l.id),
  );
  const qualifiedLeadIds = new Set(
    leads.filter((l) => ['qualified', 'won'].includes(l.status)).map((l) => l.id),
  );
  const wonLeadIds = new Set(leads.filter((l) => l.status === 'won').map((l) => l.id));

  const meetingLeadIds = new Set(leads.filter((l) => l.has_meeting_scheduled).map((l) => l.id));
  const repliedLeadIds = new Set(leads.filter((l) => l.has_replied).map((l) => l.id));

  const membershipsByCadence = groupBy(memberships, (m) => m.cadence_id);

  return cadences
    .map((cadence) => {
      const cadenceMembers = membershipsByCadence.get(cadence.id) ?? [];
      const cadenceLeadIds = new Set(cadenceMembers.map((m) => m.lead_id));

      const inscritos = cadenceLeadIds.size;
      const contacted = [...cadenceLeadIds].filter((id) => contactedLeadIds.has(id)).length;
      const qualified = [...cadenceLeadIds].filter((id) => qualifiedLeadIds.has(id)).length;
      const won = [...cadenceLeadIds].filter((id) => wonLeadIds.has(id)).length;
      const replies = [...cadenceLeadIds].filter((id) => repliedLeadIds.has(id)).length;
      const meetings = [...cadenceLeadIds].filter((id) => meetingLeadIds.has(id)).length;

      return {
        cadenceId: cadence.id,
        cadenceName: cadence.name,
        enrollments: inscritos,
        contacted,
        qualified,
        won,
        replies,
        meetings,
        conversionRate: safeRate(won, inscritos),
      };
    })
    .filter((c) => c.enrollments > 0)
    .sort((a, b) => b.conversionRate - a.conversionRate);
}

function calculateConversionByOrigin(
  leads: Array<Pick<UniverseLead, 'status' | 'created_by'>>,
): ConversionByOriginEntry[] {
  const originMap = new Map<string, { qualified: number; total: number }>();

  for (const lead of leads) {
    const origin = lead.created_by ? 'SDR' : 'Import';
    const entry = originMap.get(origin) ?? { qualified: 0, total: 0 };
    entry.total++;
    if (lead.status === 'qualified' || lead.status === 'won') entry.qualified++;
    originMap.set(origin, entry);
  }

  return Array.from(originMap.entries()).map(([origin, data]) => ({
    origin,
    qualified: data.qualified,
    unqualified: data.total - data.qualified,
    total: data.total,
    conversionRate: safeRate(data.qualified, data.total),
  }));
}
