// @vitest-environment node
/**
 * Regra de "lead aberto" num Postgres de verdade
 * (migration 20260918121458_leads_opened_count_cadence_reopen.sql).
 *
 * Uma ABERTURA é um toque humano qualificado que seja o 1º do lead na vida OU
 * o 1º depois de uma nova inscrição em cadência (REABERTURA). Os cenários abaixo
 * são escritos à mão, um por regra, para que a expectativa seja óbvia na leitura.
 *
 * Reaproveita a fixture e o runner de `statistics-rpcs.test.ts`. Roda só com
 * STATS_TEST_PG_URL apontando para um Postgres LOCAL (superusuário).
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isLocalSupabaseUrl } from '../helpers/supabase-test-client';

const PG_URL = process.env.STATS_TEST_PG_URL;
const RUN = isLocalSupabaseUrl(PG_URL);
const PSQL = (process.env.STATS_TEST_PSQL ?? 'psql').split(/\s+/).filter(Boolean);
const ROOT = path.resolve(__dirname, '../..');
const DB = `leads_opened_it_${randomBytes(4).toString('hex')}`;

/**
 * Migrations do repo que mexem na cadeia de "leads abertos", em ordem: é isso que
 * está sob teste. Pega tanto as que (re)definem a RPC quanto as que só ajustam
 * permissão do helper — uma correção futura entra no teste sozinha.
 */
const MIGRATIONS = fs
  .readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `supabase/migrations/${f}`)
  .filter((f) => {
    const sql = fs.readFileSync(path.join(ROOT, f), 'utf8');
    return (
      /FUNCTION\s+public\.count_leads_opened_by_sdr\s*\(/i.test(sql) ||
      /FUNCTION\s+public\.leads_opened_events\s*\(/i.test(sql)
    );
  });

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

const jsonLit = (v: unknown) => `$json$${JSON.stringify(v)}$json$::json`;

// ── Cenários ─────────────────────────────────────────────────────────────────
const ORG = '00000000-0000-4000-8001-000000000001';
const SDR = '00000000-0000-4000-8002-000000000001';
const CAD1 = '00000000-0000-4000-8003-000000000001';
const CAD2 = '00000000-0000-4000-8003-000000000002';

const lead = (n: number) => `00000000-0000-4000-8010-${String(n).padStart(12, '0')}`;
/** 2026: maio = mês "antigo", setembro = mês sob medição. */
const MAI = (d: number) => `2026-05-${String(d).padStart(2, '0')}T14:00:00.000Z`;
const SET = (d: number) => `2026-09-${String(d).padStart(2, '0')}T14:00:00.000Z`;
const SET_START = '2026-09-01T03:00:00.000Z';
const SET_END = '2026-10-01T03:00:00.000Z';

type Cenario = {
  nome: string;
  lead: number;
  status?: string;
  /** [quando, canal, tipo, cadence_id|null, is_note?] */
  toques: Array<[string, string, string, string | null, boolean?]>;
  /** enrolled_at das inscrições */
  inscricoes: Array<[string, string]>;
  esperadoSetembro: number;
};

const CENARIOS: Cenario[] = [
  {
    nome: 'lead novo tocado em setembro conta 1',
    lead: 1,
    toques: [[SET(3), 'phone', 'sent', CAD1]],
    inscricoes: [[SET(2), CAD1]],
    esperadoSetembro: 1,
  },
  {
    nome: 'lead tocado em maio, reinscrito e tocado em setembro conta de novo (caso Giovani)',
    lead: 2,
    toques: [
      [MAI(10), 'research', 'sent', CAD1],
      [SET(9), 'phone', 'sent', CAD2],
    ],
    inscricoes: [
      [MAI(9), CAD1],
      [SET(8), CAD2],
    ],
    esperadoSetembro: 1,
  },
  {
    nome: 'lead tocado em maio e tocado de novo em setembro SEM reinscrição não conta',
    lead: 3,
    toques: [
      [MAI(10), 'phone', 'sent', CAD1],
      [SET(9), 'phone', 'sent', CAD1],
    ],
    inscricoes: [[MAI(9), CAD1]],
    esperadoSetembro: 0,
  },
  {
    nome: 'mesmo toque pelos dois caminhos com cadências diferentes conta 1 vez só',
    lead: 4,
    // 1º toque da vida tem cadence_id NULL; a inscrição aponta CAD1. Sem o
    // DISTINCT na função, este lead contaria 2x.
    toques: [[SET(4), 'phone', 'sent', null]],
    inscricoes: [[SET(4), CAD1]],
    esperadoSetembro: 1,
  },
  {
    nome: 'duas reinscrições no mesmo mês contam 2 aberturas',
    lead: 5,
    toques: [
      [SET(2), 'phone', 'sent', CAD1],
      [SET(20), 'phone', 'sent', CAD2],
    ],
    inscricoes: [
      [SET(1), CAD1],
      [SET(19), CAD2],
    ],
    esperadoSetembro: 2,
  },
  {
    nome: 'nota importada não abre lead',
    lead: 6,
    toques: [[SET(5), 'research', 'sent', null, true]],
    inscricoes: [[SET(4), CAD1]],
    esperadoSetembro: 0,
  },
  {
    nome: 'lead arquivado não conta',
    lead: 7,
    status: 'archived',
    toques: [[SET(6), 'phone', 'sent', CAD1]],
    inscricoes: [[SET(5), CAD1]],
    esperadoSetembro: 0,
  },
  {
    nome: 'reinscrição sem nenhum toque depois não conta',
    lead: 8,
    toques: [[MAI(10), 'phone', 'sent', CAD1]],
    inscricoes: [
      [MAI(9), CAD1],
      [SET(8), CAD2],
    ],
    esperadoSetembro: 0,
  },
  {
    nome: 'canal fora da lista (system) não abre lead',
    lead: 9,
    toques: [[SET(7), 'system', 'sent', null]],
    inscricoes: [[SET(6), CAD1]],
    esperadoSetembro: 0,
  },
];

const ESPERADO_SETEMBRO = CENARIOS.reduce((a, c) => a + c.esperadoSetembro, 0);

describe.skipIf(!RUN)('regra de lead aberto (abertura + reabertura) num Postgres de verdade', () => {
  beforeAll(() => {
    psqlOrThrow('postgres', `create database ${DB};`);
    const schema = fs.readFileSync(
      path.join(ROOT, 'tests/integration/fixtures/statistics-schema.sql'),
      'utf8',
    );
    const migrations = MIGRATIONS.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
    psqlOrThrow(DB, `${schema}\n${migrations}`);

    const leads = CENARIOS.map((c) => ({
      id: lead(c.lead),
      org_id: ORG,
      status: c.status ?? 'contacted',
      assigned_to: SDR,
      created_at: MAI(1),
    }));
    const interactions = CENARIOS.flatMap((c) =>
      c.toques.map(([quando, canal, tipo, cad, isNote], i) => ({
        id: `00000000-0000-4000-8020-${String(c.lead * 100 + i).padStart(12, '0')}`,
        org_id: ORG,
        lead_id: lead(c.lead),
        performed_by: SDR,
        channel: canal,
        type: tipo,
        cadence_id: cad,
        metadata: isNote ? { is_note: true } : null,
        created_at: quando,
      })),
    );
    const enrollments = CENARIOS.flatMap((c) =>
      c.inscricoes.map(([quando, cad], i) => ({
        id: `00000000-0000-4000-8030-${String(c.lead * 100 + i).padStart(12, '0')}`,
        org_id: ORG,
        lead_id: lead(c.lead),
        cadence_id: cad,
        enrolled_by: SDR,
        enrolled_at: quando,
        updated_at: quando,
      })),
    );

    const insert = (table: string, rows: unknown[]) =>
      `insert into public.${table} select * from json_populate_recordset(null::public.${table}, ${jsonLit(rows)});`;
    psqlOrThrow(
      DB,
      [
        insert('organizations', [{ id: ORG, lead_visibility_mode: 'all' }]),
        insert('organization_members', [
          { org_id: ORG, user_id: SDR, role: 'sdr', status: 'active', accepted_at: MAI(1) },
        ]),
        insert('cadences', [
          { id: CAD1, org_id: ORG, deleted_at: null },
          { id: CAD2, org_id: ORG, deleted_at: null },
        ]),
        insert('leads', leads),
        insert('interactions', interactions),
        insert('cadence_enrollments', enrollments),
      ].join('\n'),
    );
  }, 120_000);

  afterAll(() => {
    psql('postgres', `drop database if exists ${DB} with (force);`);
  });

  it('aplica as migrations da regra nova', () => {
    expect(MIGRATIONS.map((f) => path.basename(f))).toEqual(
      expect.arrayContaining([
        '20260918121458_leads_opened_count_cadence_reopen.sql',
        '20260918122225_leads_opened_events_grant_service_role.sql',
      ]),
    );
  });

  /** Conta aberturas de UM lead em setembro, como service_role. */
  const aberturasDoLead = (n: number): number => {
    const out = psqlOrThrow(
      DB,
      `begin; set local role service_role;
       select count(*) from public.leads_opened_events('${ORG}'::uuid, null) e
       where e.lead_id = '${lead(n)}'::uuid
         and e.opened_at >= '${SET_START}' and e.opened_at < '${SET_END}';
       rollback;`,
    );
    return Number(out);
  };

  it.each(CENARIOS.map((c) => [c.nome, c.lead, c.esperadoSetembro] as const))(
    '%s',
    (_nome, n, esperado) => {
      expect(aberturasDoLead(n)).toBe(esperado);
    },
  );

  it('o total por SDR soma os cenários', () => {
    const out = psqlOrThrow(
      DB,
      `begin; set local role service_role;
       select coalesce(sum(cnt), 0) from public.count_leads_opened_by_sdr(
         '${ORG}'::uuid, '${SET_START}'::timestamptz, '${SET_END}'::timestamptz, null);
       rollback;`,
    );
    expect(Number(out)).toBe(ESPERADO_SETEMBRO);
  });

  it('a série diária tem uma linha por abertura (bate com o agregado)', () => {
    const out = psqlOrThrow(
      DB,
      `begin; set local role service_role;
       select count(*) from public.count_leads_opened_by_sdr_daily(
         '${ORG}'::uuid, '${SET_START}'::timestamptz, '${SET_END}'::timestamptz, null);
       rollback;`,
    );
    expect(Number(out)).toBe(ESPERADO_SETEMBRO);
  });

  it('o filtro de cadência considera a cadência da inscrição que reabriu', () => {
    // Lead 2 reabriu pela CAD2 em setembro; filtrar por CAD2 mantém, por CAD1 remove.
    const comCad = (cad: string) =>
      Number(
        psqlOrThrow(
          DB,
          `begin; set local role service_role;
           select count(*) from public.leads_opened_events('${ORG}'::uuid, array['${cad}']::uuid[]) e
           where e.lead_id = '${lead(2)}'::uuid
             and e.opened_at >= '${SET_START}' and e.opened_at < '${SET_END}';
           rollback;`,
        ),
      );
    expect(comCad(CAD2)).toBe(1);
    expect(comCad(CAD1)).toBe(0);
  });

  // Pós-auditoria SECURITY DEFINER de 09/09/2026, estas funções saíram da
  // allowlist de authenticated/anon: quem lê o dashboard é a service role.
  // O guard de organização dentro da RPC continua no código como 2ª camada,
  // mas a 1ª barreira — e a que este teste fixa — é a ACL.
  it.each(['authenticated', 'anon'] as const)('%s não executa as funções', (role) => {
    for (const fn of [
      `public.count_leads_opened_by_sdr('${ORG}'::uuid, '${SET_START}'::timestamptz, '${SET_END}'::timestamptz, null)`,
      `public.count_leads_opened_by_sdr_daily('${ORG}'::uuid, '${SET_START}'::timestamptz, '${SET_END}'::timestamptz, null)`,
      `public.leads_opened_events('${ORG}'::uuid, null)`,
    ]) {
      const r = psql(
        DB,
        `begin; set local role ${role};
         set local "request.jwt.claims" = '{"sub":"${SDR}","role":"${role}"}';
         select * from ${fn};
         rollback;`,
      );
      expect(r.ok).toBe(false);
      expect(r.err).toMatch(/permission denied/i);
    }
  });
});
