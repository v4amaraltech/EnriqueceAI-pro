// @vitest-environment node
/**
 * Teste de integração das funções de estatística num Postgres de verdade
 * (story statistics-rpc-integration-tests, "banco de teste enxuto").
 *
 * - Cria um banco descartável `stats_it_<aleatório>`, aplica o schema mínimo
 *   copiado de prod (`fixtures/statistics-schema.sql`) e, por cima, TODAS AS
 *   MIGRATIONS DO REPO QUE DEFINEM AS DUAS FUNÇÕES, como estão — é isso que
 *   está sob teste.
 * - Chama as funções como gestor (`set local role authenticated` + claims),
 *   com a RLS valendo, e compara com a referência em JS
 *   (`tests/helpers/statistics-references.ts`), a mesma dos testes unitários.
 *
 * Roda só com `STATS_TEST_PG_URL` apontando para um Postgres LOCAL
 * (superusuário). `STATS_TEST_PSQL` = comando do psql (padrão `psql`; na
 * máquina do dev: `docker exec -i supabase_db_flux psql`).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type RefCadence,
  type RefEnrollment,
  type RefInteraction,
  type RefLead,
  conversionUniverseReference,
  interactionCountsReference,
} from '../helpers/statistics-references';
import { isLocalSupabaseUrl } from '../helpers/supabase-test-client';

const PG_URL = process.env.STATS_TEST_PG_URL;
const RUN = isLocalSupabaseUrl(PG_URL);
const PSQL = (process.env.STATS_TEST_PSQL ?? 'psql').split(/\s+/).filter(Boolean);
const ROOT = path.resolve(__dirname, '../..');
/**
 * Todas as migrations do repo que (re)definem as duas funções, em ordem — uma
 * correção futura entra no teste sozinha.
 */
const MIGRATIONS = fs
  .readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `supabase/migrations/${f}`)
  .filter((f) =>
    /FUNCTION\s+public\.get_(conversion_universe|interaction_counts)\s*\(/i.test(
      fs.readFileSync(path.join(ROOT, f), 'utf8'),
    ),
  );

/** md5 de prod em 2026-09-11 (AC7): funções de org e políticas de leitura. */
const PROD_MD5 = {
  'fn is_manager': '22ed2d26a5fc3c3e10927e412f03e76f',
  'fn lead_visibility_mode': '372052abb6c84f83a624cb4e9c58774c',
  'fn user_org_id': '6926a8470a00bcb575394b8166e2591a',
  'pol cadence_enrollments.enrollments_org_read': 'b61f1aba9bc6d4b1ed17d67505c92795',
  'pol cadences.cadences_org_read': 'b61f1aba9bc6d4b1ed17d67505c92795',
  'pol interactions.interactions_org_read': 'b61f1aba9bc6d4b1ed17d67505c92795',
  'pol leads.leads_org_read': '5f6fbe75e95b2a6e76dad5f900d0920d',
  'pol organization_members.members_org_read': 'b61f1aba9bc6d4b1ed17d67505c92795',
  'pol organizations.org_member_read': 'c9277a69b4226b403b7d340524c7408b',
};

// ── psql ─────────────────────────────────────────────────────────────────────
function dbUrl(db: string): string {
  const u = new URL(PG_URL!);
  u.pathname = `/${db}`;
  return u.toString();
}

function psql(db: string, sql: string): { ok: boolean; out: string; err: string } {
  const [cmd, ...pre] = PSQL;
  const r = spawnSync(cmd!, [...pre, dbUrl(db), '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], {
    input: sql,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function psqlOrThrow(db: string, sql: string): string {
  const r = psql(db, sql);
  if (!r.ok) throw new Error(`psql falhou: ${r.err}`);
  return r.out;
}

/** Roda `select` como um papel/usuário (RLS valendo) e devolve o JSON agregado. */
function asUser(db: string, role: 'authenticated' | 'anon', sub: string | null, select: string) {
  const claims = sub ? `set local "request.jwt.claims" = '{"sub":"${sub}","role":"${role}"}';` : '';
  return psql(
    db,
    `begin; set local role ${role}; ${claims}
     select coalesce(json_agg(t), '[]'::json) from (${select}) t;
     rollback;`,
  );
}

const jsonLit = (v: unknown) => `$json$${JSON.stringify(v)}$json$::json`;
const arr = (ids: string[] | null) =>
  ids ? `array[${ids.map((i) => `'${i}'`).join(',')}]::uuid[]` : 'null';
const uuidOrNull = (id: string | null) => (id ? `'${id}'::uuid` : 'null');

// ── Dados determinísticos ────────────────────────────────────────────────────
let seed = 7;
const rand = () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
  return seed / 2 ** 31;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
const id = (prefix: number, n: number) =>
  `00000000-0000-4000-8${String(prefix).padStart(3, '0')}-${String(n).padStart(12, '0')}`;
const ts = (dayOfAug: number, hour: number, min = 0) =>
  new Date(Date.UTC(2026, 7, dayOfAug, hour, min, Math.floor(rand() * 60))).toISOString();

const START = '2026-08-01T03:00:00.000Z';
const END = '2026-09-01T02:59:59.999Z';

const ORG_A = id(1, 1);
const ORG_B = id(1, 2);
const MGR_A = id(2, 1);
const SDR_A = id(2, 2);
const EX_A = id(2, 3); // ex-membro (removed)
const MGR_B = id(2, 4);
const CAD_A1 = id(3, 1);
const CAD_A2 = id(3, 2);
const CAD_ADEL = id(3, 3); // cadência excluída
const CAD_B1 = id(3, 4);

const organizations = [
  { id: ORG_A, lead_visibility_mode: 'all' },
  { id: ORG_B, lead_visibility_mode: 'all' },
];
const members = [
  { org_id: ORG_A, user_id: MGR_A, role: 'manager', status: 'active', accepted_at: ts(1, 12) },
  { org_id: ORG_A, user_id: SDR_A, role: 'sdr', status: 'active', accepted_at: ts(1, 12) },
  { org_id: ORG_A, user_id: EX_A, role: 'sdr', status: 'removed', accepted_at: ts(1, 12) },
  { org_id: ORG_B, user_id: MGR_B, role: 'manager', status: 'active', accepted_at: ts(1, 12) },
];
const cadences: Array<RefCadence & { org_id: string }> = [
  { id: CAD_A1, org_id: ORG_A, deleted_at: null },
  { id: CAD_A2, org_id: ORG_A, deleted_at: null },
  { id: CAD_ADEL, org_id: ORG_A, deleted_at: ts(10, 12) },
  { id: CAD_B1, org_id: ORG_B, deleted_at: null },
];

type Lead = RefLead & { org_id: string; assigned_to: string | null };
function makeLeads(org: string, prefix: number, n: number, people: (string | null)[]): Lead[] {
  return Array.from({ length: n }, (_, i) => {
    const inside = rand() < 0.5;
    const maybe = (p: number) =>
      rand() < p ? ts(1 + Math.floor(rand() * 31), Math.floor(rand() * 24)) : null;
    return {
      id: id(prefix, i),
      org_id: org,
      status: pick(['new', 'contacted', 'qualified', 'won', 'unqualified'] as const),
      created_by: pick(people),
      assigned_to: pick(people),
      created_at: inside ? ts(1 + Math.floor(rand() * 31), Math.floor(rand() * 24)) : ts(-20, 12),
      won_at: maybe(0.15),
      lost_at: maybe(0.15),
      meeting_held_at: maybe(0.1),
      deleted_at: rand() < 0.08 ? ts(20, 12) : null,
    };
  });
}
const leadsA = makeLeads(ORG_A, 10, 60, [MGR_A, SDR_A, EX_A, null]);
const leadsB = makeLeads(ORG_B, 11, 15, [MGR_B, null]);

type Interaction = RefInteraction & { id: string; org_id: string };
function makeInteractions(
  org: string,
  prefix: number,
  n: number,
  leads: Lead[],
  people: (string | null)[],
  cads: (string | null)[],
): Interaction[] {
  const channels = [
    'email',
    'whatsapp',
    'phone',
    'research',
    'linkedin',
    'calendar',
    'system',
  ] as const;
  const types = [
    'sent',
    'delivered',
    'opened',
    'clicked',
    'replied',
    'meeting_scheduled',
    'failed',
  ] as const;
  return Array.from({ length: n }, (_, i) => {
    const day = Math.floor(rand() * 34) - 1; // alguns fora do período
    const hour = rand() < 0.25 ? Math.floor(rand() * 3) : Math.floor(rand() * 24); // 00–03h UTC = dia anterior BRT
    return {
      id: id(prefix, i),
      org_id: org,
      lead_id: pick(leads).id,
      performed_by: pick(people),
      channel: pick(channels),
      type: pick(types),
      cadence_id: pick(cads),
      created_at: ts(day, hour, Math.floor(rand() * 60)),
    };
  });
}
const interactionsA = makeInteractions(
  ORG_A,
  20,
  500,
  leadsA,
  [MGR_A, SDR_A, SDR_A, EX_A, null],
  [CAD_A1, CAD_A2, CAD_ADEL, null],
);
const interactionsB = makeInteractions(ORG_B, 21, 80, leadsB, [MGR_B, null], [CAD_B1, null]);

type Enrollment = RefEnrollment & { org_id: string };
function makeEnrollments(
  org: string,
  prefix: number,
  n: number,
  leads: Lead[],
  people: (string | null)[],
  cads: string[],
): Enrollment[] {
  return Array.from({ length: n }, (_, i) => {
    const enrolled = ts(Math.floor(rand() * 40) - 8, Math.floor(rand() * 24));
    return {
      id: id(prefix, i),
      org_id: org,
      lead_id: pick(leads).id,
      cadence_id: pick(cads),
      enrolled_by: pick(people),
      enrolled_at: enrolled,
      updated_at: new Date(
        Date.parse(enrolled) + Math.floor(rand() * 10 * 86_400_000),
      ).toISOString(),
    };
  });
}
const enrollmentsA = makeEnrollments(
  ORG_A,
  30,
  90,
  leadsA,
  [MGR_A, SDR_A, EX_A, null],
  [CAD_A1, CAD_A2, CAD_ADEL],
);
const enrollmentsB = makeEnrollments(ORG_B, 31, 15, leadsB, [MGR_B], [CAD_B1]);

/**
 * Leads "de borda" (revisão de QA): cada um entra no universo da Conversão por
 * UM único motivo — sem interação, criado antes do período — e um não entra
 * por nenhum. Sem eles, tirar uma regra do universo passava despercebido
 * (quase todo lead aleatório tem interação no período).
 */
const OUTSIDE = ts(-20, 12);
const edge = (n: number, over: Partial<Lead>): Lead => ({
  id: id(12, n),
  org_id: ORG_A,
  status: 'contacted',
  created_by: SDR_A,
  assigned_to: SDR_A,
  created_at: OUTSIDE,
  won_at: null,
  lost_at: null,
  meeting_held_at: null,
  deleted_at: null,
  ...over,
});
const edgeLeadsA: Lead[] = [
  edge(1, { created_at: ts(5, 12) }), // só criado no período
  edge(2, { status: 'won', won_at: ts(6, 12) }), // só ganho no período
  edge(3, { status: 'unqualified', lost_at: ts(7, 12) }), // só perdido no período
  edge(4, { meeting_held_at: ts(8, 12) }), // só reunião realizada no período
  edge(5, {}), // nenhum motivo → fora do universo
  edge(6, { won_at: ts(-5, 12), lost_at: ts(40, 12) }), // datas fora do período → fora
];
const allLeadsA = [...leadsA, ...edgeLeadsA];

// ── Normalização (o banco devolve timestamptz com offset; a referência, ISO) ──
const ms = (x: unknown) => (x == null ? null : Date.parse(String(x)));
type CountRow = Record<string, unknown>;
function normCounts(rows: CountRow[]) {
  return Object.fromEntries(
    rows.map((r) => [
      [r.row_kind, r.performed_by, r.channel, r.type, r.day_brt].join('|'),
      { n: r.n, distinct_leads: r.distinct_leads, first: ms(r.first_at), last: ms(r.last_at) },
    ]),
  );
}
function normUniverse(rows: Array<Record<string, unknown>>) {
  return Object.fromEntries(
    rows.map((r) => [
      r.lead_id,
      {
        status: r.status,
        created_by: r.created_by,
        won: ms(r.won_at),
        flags: [r.has_sent, r.has_meeting_scheduled, r.has_replied],
        enrollments: (r.enrollments as Array<Record<string, unknown>>).map((e) => [
          e.cadence_id,
          ms(e.enrolled_at),
          ms(e.updated_at),
          e.for_velocity,
        ]),
      },
    ]),
  );
}

// ── Banco descartável ────────────────────────────────────────────────────────
const DB = `stats_it_${randomBytes(4).toString('hex')}`;

describe.skipIf(!RUN)('funções de estatística num Postgres de verdade', () => {
  it('aplica as migrations que definem as duas funções', () => {
    expect(MIGRATIONS.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining([
        '20260911030704_get_conversion_universe.sql',
        '20260911095436_get_interaction_counts.sql',
      ]),
    );
  });

  beforeAll(() => {
    psqlOrThrow('postgres', `create database ${DB};`);
    const schema = fs.readFileSync(
      path.join(ROOT, 'tests/integration/fixtures/statistics-schema.sql'),
      'utf8',
    );
    const migrations = MIGRATIONS.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join(
      '\n',
    );
    psqlOrThrow(DB, `${schema}\n${migrations}`);
    const insert = (table: string, rows: unknown[]) =>
      `insert into public.${table} select * from json_populate_recordset(null::public.${table}, ${jsonLit(rows)});`;
    psqlOrThrow(
      DB,
      [
        insert('organizations', organizations),
        insert('organization_members', members),
        insert('cadences', cadences),
        insert('leads', [...allLeadsA, ...leadsB]),
        insert('interactions', [...interactionsA, ...interactionsB]),
        insert('cadence_enrollments', [...enrollmentsA, ...enrollmentsB]),
      ].join('\n'),
    );
  }, 120_000);

  afterAll(() => {
    psql('postgres', `drop database if exists ${DB} with (force);`);
  });

  const counts = (
    sub: string,
    exclude: string[],
    users: string[] | null,
    cadence: string | null,
  ) => {
    const r = asUser(
      DB,
      'authenticated',
      sub,
      `select * from public.get_interaction_counts('${START}', '${END}', '{${exclude.join(',')}}'::public.channel_type[], ${arr(users)}, ${uuidOrNull(cadence)})`,
    );
    if (!r.ok) throw new Error(r.err);
    return JSON.parse(r.out) as CountRow[];
  };
  const universe = (sub: string, users: string[] | null, cadence: string | null) => {
    const r = asUser(
      DB,
      'authenticated',
      sub,
      `select * from public.get_conversion_universe('${START}', '${END}', ${arr(users)}, ${uuidOrNull(cadence)})`,
    );
    if (!r.ok) throw new Error(r.err);
    return JSON.parse(r.out) as Array<Record<string, unknown>>;
  };
  const argsOf = (users: string[] | null, cadence: string | null, exclude?: string[]) => ({
    p_start: START,
    p_end: END,
    ...(exclude ? { p_exclude_channels: exclude } : {}),
    ...(users ? { p_user_ids: users } : {}),
    ...(cadence ? { p_cadence_id: cadence } : {}),
  });

  it.each([
    ['Atividades: sem system/calendar, sem filtro', ['system', 'calendar'], null, null],
    ['Performance: sem system, membros ativos', ['system'], [MGR_A, SDR_A], null],
    ['Performance: 1 SDR + cadência', ['system'], [SDR_A], CAD_A1],
    ['cadência excluída como filtro', ['system'], null, CAD_ADEL],
  ] as const)('get_interaction_counts = referência — %s', (_label, exclude, users, cadence) => {
    const got = counts(MGR_A, [...exclude], users ? [...users] : null, cadence);
    const want = interactionCountsReference(
      interactionsA,
      argsOf(users ? [...users] : null, cadence, [...exclude]),
    );
    expect(got.length).toBeGreaterThan(0);
    expect(normCounts(got)).toEqual(normCounts(want as unknown as CountRow[]));
  });

  it.each([
    ['sem filtro', null, null],
    ['filtro de SDR (created_by / enrolled_by)', [SDR_A, EX_A], null],
    ['filtro de cadência', null, CAD_A1],
    ['cadência excluída como filtro', null, CAD_ADEL],
  ] as const)('get_conversion_universe = referência — %s', (_label, users, cadence) => {
    const got = universe(MGR_A, users ? [...users] : null, cadence);
    const want = conversionUniverseReference(
      {
        leads: allLeadsA,
        interactions: interactionsA,
        cadences: cadences.filter((c) => c.org_id === ORG_A),
        enrollments: enrollmentsA,
      },
      argsOf(users ? [...users] : null, cadence),
    );
    expect(got.length).toBeGreaterThan(0);
    expect(normUniverse(got)).toEqual(
      normUniverse(want as unknown as Array<Record<string, unknown>>),
    );
  });

  it('universo da Conversão: cada regra de entrada conta sozinha (leads de borda)', () => {
    const ids = new Set(universe(MGR_A, null, null).map((r) => String(r.lead_id)));
    expect(edgeLeadsA.slice(0, 4).map((l) => ids.has(l.id))).toEqual([true, true, true, true]);
    expect(edgeLeadsA.slice(4).map((l) => ids.has(l.id))).toEqual([false, false]);
  });

  it('isolamento: o gestor da org B só vê a org B', () => {
    const aLeads = new Set(allLeadsA.map((l) => l.id));
    const aPeople = new Set([MGR_A, SDR_A, EX_A]);
    const u = universe(MGR_B, null, null);
    expect(u.length).toBeGreaterThan(0);
    expect(u.some((r) => aLeads.has(String(r.lead_id)))).toBe(false);
    const c = counts(MGR_B, ['system'], null, null);
    expect(c.length).toBeGreaterThan(0);
    expect(c.some((r) => aPeople.has(String(r.performed_by)))).toBe(false);
    // e bate com a referência só com os dados da org B
    expect(normCounts(c)).toEqual(
      normCounts(
        interactionCountsReference(
          interactionsB,
          argsOf(null, null, ['system']),
        ) as unknown as CountRow[],
      ),
    );
  });

  it('anon não executa as funções (REVOKE da própria migration)', () => {
    for (const sel of [
      `select * from public.get_interaction_counts('${START}', '${END}', '{system}'::public.channel_type[])`,
      `select * from public.get_conversion_universe('${START}', '${END}')`,
    ]) {
      const r = asUser(DB, 'anon', null, sel);
      expect(r.ok).toBe(false);
      expect(r.err).toMatch(/permission denied for function/);
    }
  });

  it('schema mínimo continua igual a prod (md5 das funções de org e das políticas)', () => {
    const out = psqlOrThrow(
      DB,
      `select 'fn '||p.proname||'='||md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname in ('user_org_id','is_manager','lead_visibility_mode')
       union all
       select 'pol '||tablename||'.'||policyname||'='||md5(qual) from pg_policies where schemaname='public';`,
    );
    const got = Object.fromEntries(out.split('\n').map((l) => l.split('=') as [string, string]));
    expect(got).toEqual(PROD_MD5);
  });
});
