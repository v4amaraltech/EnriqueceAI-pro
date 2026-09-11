/**
 * Referências em JS das funções SQL de estatística — a "especificação" usada
 * pelos testes unitários (fake PostgREST) e pelos de integração (Supabase
 * local). Se a SQL e a referência discordarem, o teste de integração fica
 * vermelho. Story statistics-rpc-integration-tests.
 *
 * - `interactionCountsReference` ↔ `public.get_interaction_counts`
 *   (migration 20260911095436)
 * - `conversionUniverseReference` ↔ `public.get_conversion_universe`
 *   (migration 20260911030704)
 *
 * As entradas são as linhas brutas das tabelas JÁ restritas à org de quem
 * chama (a SQL faz isso com `user_org_id()` + RLS).
 */

type Args = Record<string, unknown>;

const inRange = (iso: string | null | undefined, start: string, end: string) =>
  iso != null && Date.parse(iso) >= Date.parse(start) && Date.parse(iso) <= Date.parse(end);

/** Dia de Brasília como a SQL calcula: `(created_at AT TIME ZONE 'UTC' - 3h)::date`. */
export const dayBrt = (iso: string) =>
  new Date(Date.parse(iso) - 3 * 3_600_000).toISOString().slice(0, 10);

const earlier = (a: string, b: string) => (Date.parse(a) <= Date.parse(b) ? a : b);
const later = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

// ── get_interaction_counts ───────────────────────────────────────────────────

export interface RefInteraction {
  lead_id: string;
  performed_by: string | null;
  channel: string;
  type: string;
  cadence_id: string | null;
  created_at: string;
}

export interface InteractionCountRow {
  row_kind: 'cell' | 'performer';
  performed_by: string | null;
  channel: string | null;
  type: string | null;
  day_brt: string | null;
  n: number | null;
  distinct_leads: number | null;
  first_at: string;
  last_at: string;
}

export function interactionCountsReference(
  interactions: readonly RefInteraction[],
  args: Args,
): InteractionCountRow[] {
  const start = String(args.p_start);
  const end = String(args.p_end);
  const exclude = new Set((args.p_exclude_channels as string[] | undefined) ?? []);
  const users = (args.p_user_ids as string[] | null | undefined) ?? [];
  const cadence = (args.p_cadence_id as string | null | undefined) ?? null;

  const rows = interactions.filter(
    (i) =>
      inRange(i.created_at, start, end) &&
      !exclude.has(i.channel) &&
      (users.length === 0 || (i.performed_by !== null && users.includes(i.performed_by))) &&
      (!cadence || i.cadence_id === cadence),
  );

  const cells = new Map<string, InteractionCountRow>();
  const performers = new Map<string, { row: InteractionCountRow; leads: Set<string> }>();
  for (const i of rows) {
    const day = dayBrt(i.created_at);
    const key = [i.performed_by, i.channel, i.type, day].join('|');
    const cell = cells.get(key);
    if (cell) {
      cell.n = (cell.n ?? 0) + 1;
      cell.first_at = earlier(cell.first_at, i.created_at);
      cell.last_at = later(cell.last_at, i.created_at);
    } else {
      cells.set(key, {
        row_kind: 'cell',
        performed_by: i.performed_by,
        channel: i.channel,
        type: i.type,
        day_brt: day,
        n: 1,
        distinct_leads: null,
        first_at: i.created_at,
        last_at: i.created_at,
      });
    }

    const pk = String(i.performed_by);
    const p = performers.get(pk);
    if (p) {
      p.leads.add(i.lead_id);
      p.row.first_at = earlier(p.row.first_at, i.created_at);
      p.row.last_at = later(p.row.last_at, i.created_at);
    } else {
      performers.set(pk, {
        leads: new Set([i.lead_id]),
        row: {
          row_kind: 'performer',
          performed_by: i.performed_by,
          channel: null,
          type: null,
          day_brt: null,
          n: null,
          distinct_leads: null,
          first_at: i.created_at,
          last_at: i.created_at,
        },
      });
    }
  }
  return [
    ...cells.values(),
    ...[...performers.values()].map((p) => ({ ...p.row, distinct_leads: p.leads.size })),
  ];
}

// ── get_conversion_universe ──────────────────────────────────────────────────

export interface RefLead {
  id: string;
  status: string;
  created_by: string | null;
  created_at: string;
  won_at: string | null;
  lost_at: string | null;
  meeting_held_at: string | null;
  deleted_at: string | null;
}

export interface RefCadence {
  id: string;
  deleted_at: string | null;
}

export interface RefEnrollment {
  id: string;
  lead_id: string;
  cadence_id: string;
  enrolled_by: string | null;
  enrolled_at: string;
  updated_at: string;
}

export interface ConversionUniverseRow {
  lead_id: string;
  status: string;
  created_by: string | null;
  won_at: string | null;
  has_sent: boolean;
  has_meeting_scheduled: boolean;
  has_replied: boolean;
  enrollments: Array<{
    cadence_id: string;
    enrolled_at: string;
    updated_at: string;
    for_velocity: boolean;
  }>;
}

export function conversionUniverseReference(
  data: {
    leads: readonly RefLead[];
    interactions: readonly RefInteraction[];
    cadences: readonly RefCadence[];
    enrollments: readonly RefEnrollment[];
  },
  args: Args,
): ConversionUniverseRow[] {
  const start = String(args.p_start);
  const end = String(args.p_end);
  const users = (args.p_user_ids as string[] | null | undefined) ?? [];
  const cadence = (args.p_cadence_id as string | null | undefined) ?? null;

  // Marcadores: interações do período (só da cadência filtrada, se houver).
  const flags = new Map<string, { sent: boolean; meeting: boolean; replied: boolean }>();
  for (const i of data.interactions) {
    if (!inRange(i.created_at, start, end)) continue;
    if (cadence && i.cadence_id !== cadence) continue;
    const f = flags.get(i.lead_id) ?? { sent: false, meeting: false, replied: false };
    if (i.type === 'sent') f.sent = true;
    if (i.type === 'meeting_scheduled') f.meeting = true;
    if (i.type === 'replied') f.replied = true;
    flags.set(i.lead_id, f);
  }

  const universe = data.leads.filter(
    (l) =>
      l.deleted_at === null &&
      (users.length === 0 || (l.created_by !== null && users.includes(l.created_by))) &&
      (inRange(l.created_at, start, end) ||
        inRange(l.won_at, start, end) ||
        inRange(l.lost_at, start, end) ||
        inRange(l.meeting_held_at, start, end) ||
        flags.has(l.id)),
  );
  const universeIds = new Set(universe.map((l) => l.id));

  const cadSet = new Set(
    cadence ? [cadence] : data.cadences.filter((c) => c.deleted_at === null).map((c) => c.id),
  );
  const byLead = new Map<string, RefEnrollment[]>();
  for (const e of data.enrollments) {
    if (!cadSet.has(e.cadence_id) || !universeIds.has(e.lead_id)) continue;
    const arr = byLead.get(e.lead_id) ?? [];
    arr.push(e);
    byLead.set(e.lead_id, arr);
  }

  return universe.map((l) => {
    const f = flags.get(l.id);
    const enr = (byLead.get(l.id) ?? [])
      .slice()
      // mesma ordem do jsonb_agg: enrolled_at, id
      .sort(
        (a, b) => Date.parse(a.enrolled_at) - Date.parse(b.enrolled_at) || (a.id < b.id ? -1 : 1),
      );
    return {
      lead_id: l.id,
      status: l.status,
      created_by: l.created_by,
      won_at: l.won_at,
      has_sent: f?.sent ?? false,
      has_meeting_scheduled: f?.meeting ?? false,
      has_replied: f?.replied ?? false,
      enrollments: enr.map((e) => ({
        cadence_id: e.cadence_id,
        enrolled_at: e.enrolled_at,
        updated_at: e.updated_at,
        for_velocity:
          inRange(e.enrolled_at, start, end) &&
          (users.length === 0 || (e.enrolled_by !== null && users.includes(e.enrolled_by))),
      })),
    };
  });
}
