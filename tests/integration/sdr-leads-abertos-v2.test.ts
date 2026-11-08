// @vitest-environment node
/**
 * get_sdr_leads_abertos_v2 num Postgres de verdade
 * (migration 20261108190000_get_sdr_leads_abertos_v2_token.sql).
 *
 * Duas partes separadas:
 *   1. EQUIVALÊNCIA: como service_role, o JSON da _v2 é igual ao da legada
 *      get_sdr_leads_abertos(int,int) (copiada de prod na fixture) em vários
 *      meses, inclusive vazio, virada de mês no fuso de São Paulo e dezembro.
 *   2. AUTORIZAÇÃO: quem pode chamar a _v2, e que a legada não mudou.
 *
 * Base: statistics-schema.sql + migrations do repo que definem
 * leads_opened_events + fixture da legada + a migration nova, como está.
 * Token fictício gerado aqui; só o hash vai para o banco descartável.
 *
 * Roda só com STATS_TEST_PG_URL apontando para um Postgres LOCAL (superusuário).
 * STATS_TEST_PSQL = comando do psql (na máquina do dev:
 * `docker exec -i supabase_db_flux psql`).
 */
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { isLocalSupabaseUrl } from '../helpers/supabase-test-client';

const PG_URL = process.env.STATS_TEST_PG_URL;
const RUN = isLocalSupabaseUrl(PG_URL);
const PSQL = (process.env.STATS_TEST_PSQL ?? 'psql').split(/\s+/).filter(Boolean);
const ROOT = path.resolve(__dirname, '../..');
const DB = `sdr_leads_abertos_v2_it_${randomBytes(4).toString('hex')}`;

const NEW_MIGRATION = 'supabase/migrations/20261108190000_get_sdr_leads_abertos_v2_token.sql';
/** Migrations do repo que definem leads_opened_events (dependência das duas RPCs). */
const EVENT_MIGRATIONS = fs
  .readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => `supabase/migrations/${f}`)
  .filter((f) =>
    /FUNCTION\s+public\.leads_opened_events\s*\(/i.test(
      fs.readFileSync(path.join(ROOT, f), 'utf8'),
    ),
  );

/** Prod, 2026-11-08 (pg_get_functiondef). */
const PROD_MD5 = {
  legacy: 'b899208067dcb769ccca919238c65a6d',
  /**
   * leads_opened_events: o repo tem comentários que prod não tem; a lógica é a
   * mesma. Comparamos o md5 do código sem comentários nem linhas vazias.
   */
  leadsOpenedEventsNoComments: '60bbea2e929467f3d7310168be8441a4',
  userOrgId: '6926a8470a00bcb575394b8166e2591a',
};

const TOKEN = `token-ficticio-${randomBytes(12).toString('hex')}`;
const WRONG_TOKEN = `token-errado-${randomBytes(12).toString('hex')}`;

const V4 = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER = '00000000-0000-4000-8001-000000000002';
const SDR_A = '00000000-0000-4000-8002-00000000000a'; // sdr ativo
const SDR_B = '00000000-0000-4000-8002-00000000000b'; // sdr convidado (conta)
const SDR_NOMAIL = '00000000-0000-4000-8002-00000000000e'; // sdr sem auth.users
const MANAGER = '00000000-0000-4000-8002-00000000000c'; // não conta
const SUSPENDED = '00000000-0000-4000-8002-00000000000d'; // não conta
const OTHER_SDR = '00000000-0000-4000-8002-0000000000f0'; // outra org
const CAD1 = '00000000-0000-4000-8003-000000000001';
const CAD2 = '00000000-0000-4000-8003-000000000002';
const OTHER_CAD = '00000000-0000-4000-8003-000000000009';

const lead = (n: number) => `00000000-0000-4000-8010-${String(n).padStart(12, '0')}`;

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

const md5 = (s: string) => createHash('md5').update(s).digest('hex');
const stripSqlComments = (s: string) =>
  s
    .replace(/--[^\n]*/g, '')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .join('\n');

const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);
const jsonLit = (v: unknown) => `$json$${JSON.stringify(v)}$json$::json`;

type Caller = { kind: 'anon' } | { kind: 'authenticated'; sub: string } | { kind: 'service_role' };

type Result = { ok: true; json: unknown } | { ok: false; error: string };

/** Roda `expr` (que devolve jsonb) como o papel dado, numa transação desfeita. */
function as(caller: Caller, expr: string): Result {
  const claims =
    caller.kind === 'authenticated'
      ? { role: 'authenticated', sub: caller.sub }
      : { role: caller.kind };
  const r = psql(
    DB,
    `\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE ${caller.kind};
SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true) \\g /dev/null
SELECT (${expr})::text;
ROLLBACK;`,
  );
  if (!r.ok) return { ok: false, error: r.err };
  return { ok: true, json: JSON.parse(r.out.split('\n').pop() ?? 'null') };
}

const v2 = (y: number, m: number, token: string | null) =>
  `public.get_sdr_leads_abertos_v2(${y}, ${m}, ${lit(token)})`;
const legacy = (y: number, m: number) => `public.get_sdr_leads_abertos(${y}, ${m})`;

function expectForbidden(r: Result) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/42501: Forbidden/);
}

function fnInfo(sig: string) {
  return JSON.parse(
    psqlOrThrow(
      DB,
      `SELECT json_build_object(
         'md5', md5(pg_get_functiondef(p.oid)),
         'args', pg_get_function_arguments(p.oid),
         'definer', p.prosecdef,
         'volatile', p.provolatile,
         'config', p.proconfig,
         'acl', p.proacl::text,
         'public', EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE'),
         'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
         'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
         'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
         'overloads', (SELECT count(*) FROM pg_proc q WHERE q.proname = p.proname AND q.pronamespace = p.pronamespace)
       ) FROM pg_proc p WHERE p.oid = ${lit(sig)}::regprocedure;`,
    ),
  );
}

let legacyBefore: ReturnType<typeof fnInfo>;

describe.skipIf(!RUN)('get_sdr_leads_abertos_v2', () => {
  beforeAll(() => {
    psqlOrThrow('postgres', `CREATE DATABASE ${DB};`);
    const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    psqlOrThrow(
      DB,
      [
        read('tests/integration/fixtures/statistics-schema.sql'),
        ...EVENT_MIGRATIONS.map(read),
        read('tests/integration/fixtures/sdr-leads-abertos-legacy.sql'),
      ].join('\n'),
    );

    // ── Dados: V4 com reabertura, virada de mês no fuso, papéis que não contam;
    //    outra org com toques que não podem vazar.
    const leads = [
      [1, V4, SDR_A, 'contacted'],
      [2, V4, SDR_A, 'contacted'],
      [3, V4, SDR_A, 'contacted'],
      [4, V4, SDR_B, 'contacted'],
      [5, V4, SDR_NOMAIL, 'contacted'],
      [6, V4, MANAGER, 'contacted'],
      [7, V4, SUSPENDED, 'contacted'],
      [8, V4, SDR_A, 'archived'],
      [9, V4, SDR_B, 'qualified'],
      [10, OTHER, OTHER_SDR, 'contacted'],
    ].map(([n, org, who, status]) => ({
      id: lead(n as number),
      org_id: org,
      status,
      assigned_to: who,
      created_at: '2026-08-01T12:00:00Z',
    }));
    // [lead, quando (UTC), cadence_id, canal]
    const toques: Array<[number, string, string | null, string]> = [
      [1, '2026-09-10T14:00:00Z', CAD1, 'phone'], // 1º toque em set
      [1, '2026-10-15T14:00:00Z', CAD2, 'email'], // reabertura em out (nova inscrição)
      [2, '2026-11-01T02:30:00Z', CAD1, 'phone'], // 31/out 23h30 BRT → outubro
      [3, '2026-11-01T03:30:00Z', CAD1, 'whatsapp'], // 01/nov 00h30 BRT → novembro
      [4, '2026-10-03T13:00:00Z', CAD1, 'phone'], // sdr convidado conta
      [4, '2026-10-20T13:00:00Z', CAD1, 'phone'], // sem reinscrição: não reabre
      [5, '2026-10-03T15:00:00Z', CAD1, 'research'], // sdr sem e-mail (email null)
      [6, '2026-10-04T15:00:00Z', CAD1, 'phone'], // gestor: fora
      [7, '2026-10-05T15:00:00Z', CAD1, 'phone'], // suspenso: fora
      [8, '2026-10-06T15:00:00Z', CAD1, 'phone'], // arquivado: fora
      [9, '2026-12-31T23:00:00Z', CAD1, 'linkedin'], // 31/dez 20h BRT → dezembro
      [10, '2026-10-07T15:00:00Z', OTHER_CAD, 'phone'], // outra org: fora
    ];
    const interactions = toques.map(([n, when, cad, channel], i) => ({
      id: `00000000-0000-4000-8020-${String(i + 1).padStart(12, '0')}`,
      org_id: n === 10 ? OTHER : V4,
      lead_id: lead(n),
      performed_by: null,
      channel,
      type: 'sent',
      cadence_id: cad,
      metadata: null,
      created_at: when,
    }));
    const inscricoes: Array<[number, string, string]> = [
      [1, '2026-09-09T12:00:00Z', CAD1],
      [1, '2026-10-14T12:00:00Z', CAD2],
      [2, '2026-10-30T12:00:00Z', CAD1],
      [3, '2026-10-30T12:00:00Z', CAD1],
      [4, '2026-10-02T12:00:00Z', CAD1],
      [5, '2026-10-02T12:00:00Z', CAD1],
      [9, '2026-12-30T12:00:00Z', CAD1],
      [10, '2026-10-06T12:00:00Z', OTHER_CAD],
    ];
    const enrollments = inscricoes.map(([n, when, cad], i) => ({
      id: `00000000-0000-4000-8030-${String(i + 1).padStart(12, '0')}`,
      org_id: n === 10 ? OTHER : V4,
      lead_id: lead(n),
      cadence_id: cad,
      enrolled_by: null,
      enrolled_at: when,
      updated_at: when,
    }));
    const insert = (table: string, rows: unknown[]) =>
      `INSERT INTO ${table} SELECT * FROM json_populate_recordset(NULL::${table}, ${jsonLit(rows)});`;
    psqlOrThrow(
      DB,
      [
        insert('public.organizations', [
          { id: V4, lead_visibility_mode: 'all' },
          { id: OTHER, lead_visibility_mode: 'all' },
        ]),
        insert('public.organization_members', [
          {
            org_id: V4,
            user_id: SDR_A,
            role: 'sdr',
            status: 'active',
            accepted_at: '2026-01-01T00:00:00Z',
          },
          { org_id: V4, user_id: SDR_B, role: 'sdr', status: 'invited', accepted_at: null },
          {
            org_id: V4,
            user_id: SDR_NOMAIL,
            role: 'sdr',
            status: 'active',
            accepted_at: '2026-01-01T00:00:00Z',
          },
          {
            org_id: V4,
            user_id: MANAGER,
            role: 'manager',
            status: 'active',
            accepted_at: '2026-01-01T00:00:00Z',
          },
          {
            org_id: V4,
            user_id: SUSPENDED,
            role: 'sdr',
            status: 'suspended',
            accepted_at: '2026-01-01T00:00:00Z',
          },
          {
            org_id: OTHER,
            user_id: OTHER_SDR,
            role: 'sdr',
            status: 'active',
            accepted_at: '2026-01-01T00:00:00Z',
          },
        ]),
        insert('auth.users', [
          { id: SDR_A, email: 'sdr.a@example.test' },
          { id: SDR_B, email: 'sdr.b@example.test' },
          { id: MANAGER, email: 'gestor@example.test' },
          { id: SUSPENDED, email: 'suspenso@example.test' },
          { id: OTHER_SDR, email: 'sdr.outra@example.test' },
        ]),
        insert('public.cadences', [
          { id: CAD1, org_id: V4, deleted_at: null },
          { id: CAD2, org_id: V4, deleted_at: null },
          { id: OTHER_CAD, org_id: OTHER, deleted_at: null },
        ]),
        insert('public.leads', leads),
        insert('public.interactions', interactions),
        insert('public.cadence_enrollments', enrollments),
        `INSERT INTO public.api_secrets (name, token_hash)
           VALUES ('v4sales_public_rpc', encode(extensions.digest(${lit(TOKEN)}, 'sha256'), 'hex'));`,
      ].join('\n'),
    );

    legacyBefore = fnInfo('public.get_sdr_leads_abertos(integer,integer)');
    psqlOrThrow(DB, read(NEW_MIGRATION));
  }, 120_000);

  afterAll(() => {
    psql('postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`);
  });

  describe('fixture fiel a prod', () => {
    it('legada, leads_opened_events e user_org_id têm o md5 de prod', () => {
      expect(legacyBefore.md5).toBe(PROD_MD5.legacy);
      const def = psqlOrThrow(
        DB,
        `SELECT pg_get_functiondef('public.leads_opened_events(uuid,uuid[])'::regprocedure);`,
      );
      expect(md5(stripSqlComments(def))).toBe(PROD_MD5.leadsOpenedEventsNoComments);
      expect(fnInfo('public.user_org_id()').md5).toBe(PROD_MD5.userOrgId);
    });
  });

  // ── 1. Equivalência dos cálculos ──────────────────────────────────────────
  describe('equivalência com a legada (service_role)', () => {
    const MESES: Array<[number, number, string]> = [
      [2026, 9, 'setembro: 1º toque'],
      [2026, 10, 'outubro: reabertura, convidado, sem e-mail, virada de mês'],
      [2026, 11, 'novembro: lado de lá da virada de mês'],
      [2026, 12, 'dezembro: último dia do ano no fuso'],
      [2027, 1, 'janeiro/2027: sem dados'],
      [2025, 2, 'fevereiro/2025: sem dados'],
    ];

    it.each(MESES)('%i-%i (%s): JSON idêntico', (y, m) => {
      const a = as({ kind: 'service_role' }, legacy(y, m));
      const b = as({ kind: 'service_role' }, v2(y, m, null));
      expect(a.ok).toBe(true);
      expect(b).toEqual(a);
    });

    it('as fixtures exercitam os casos (outubro escrito à mão)', () => {
      const r = as({ kind: 'service_role' }, v2(2026, 10, null));
      expect(r).toEqual({
        ok: true,
        json: {
          total: 4,
          novos: 3,
          reabertos: 1,
          by_email: expect.arrayContaining([
            { email: 'sdr.a@example.test', n: 2, novos: 1, reabertos: 1 },
            { email: 'sdr.b@example.test', n: 1, novos: 1, reabertos: 0 },
            { email: null, n: 1, novos: 1, reabertos: 0 },
          ]),
          daily: [
            { dia: '2026-10-03', opened: 2 },
            { dia: '2026-10-15', opened: 1 },
            { dia: '2026-10-31', opened: 1 },
          ],
        },
      });
      if (r.ok) expect((r.json as { by_email: unknown[] }).by_email).toHaveLength(3);
    });

    it('mês sem dados: zeros e listas vazias', () => {
      expect(as({ kind: 'service_role' }, v2(2027, 1, null))).toEqual({
        ok: true,
        json: { total: 0, novos: 0, reabertos: 0, by_email: [], daily: [] },
      });
    });

    it('mês inválido: mesmo erro da legada para quem está autorizado', () => {
      const a = as({ kind: 'service_role' }, legacy(2026, 13));
      const b = as({ kind: 'service_role' }, v2(2026, 13, null));
      expect(a.ok).toBe(false);
      expect(b.ok).toBe(false);
      if (!a.ok && !b.ok) {
        expect(a.error).toMatch(/22008/);
        expect(b.error).toMatch(/22008/);
      }
    });
  });

  // ── 2. Autorização ────────────────────────────────────────────────────────
  describe('autorização da _v2', () => {
    const ESPERADO = () => as({ kind: 'service_role' }, legacy(2026, 10));

    it('anon + token válido → mesmo JSON da legada', () => {
      expect(as({ kind: 'anon' }, v2(2026, 10, TOKEN))).toEqual(ESPERADO());
    });

    it.each([
      ['inválido', WRONG_TOKEN],
      ['vazio', ''],
      ['NULL', null],
    ])('anon + token %s → 42501', (_n, token) => {
      expectForbidden(as({ kind: 'anon' }, v2(2026, 10, token)));
    });

    it('anon sem o argumento do token → não existe (sem default)', () => {
      const r = as({ kind: 'anon' }, 'public.get_sdr_leads_abertos_v2(2026, 10)');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/does not exist/);
    });

    it('anon não autorizado com mês inválido → 42501 (checagem vem antes da data)', () => {
      expectForbidden(as({ kind: 'anon' }, v2(2026, 13, null)));
    });

    it('usuário ativo da org V4, sem token → mesmo JSON da legada', () => {
      expect(as({ kind: 'authenticated', sub: SDR_A }, v2(2026, 10, null))).toEqual(ESPERADO());
    });

    it('usuário de outra org, sem token / token vazio / inválido → 42501', () => {
      for (const t of [null, '', WRONG_TOKEN]) {
        expectForbidden(as({ kind: 'authenticated', sub: OTHER_SDR }, v2(2026, 10, t)));
      }
    });

    it('usuário de outra org + token válido → passa (regra: token válido autoriza)', () => {
      expect(as({ kind: 'authenticated', sub: OTHER_SDR }, v2(2026, 10, TOKEN))).toEqual(
        ESPERADO(),
      );
    });

    it('membro V4 só convidado (user_org_id() nulo), sem token → 42501', () => {
      expectForbidden(as({ kind: 'authenticated', sub: SDR_B }, v2(2026, 10, null)));
    });

    it('service_role sem token → passa', () => {
      expect(as({ kind: 'service_role' }, v2(2026, 10, null))).toEqual(ESPERADO());
    });
  });

  // ── Permissões / preservação ──────────────────────────────────────────────
  describe('permissões', () => {
    it('_v2: assinatura sem default, DEFINER, search_path vazio, EXECUTE explícito sem PUBLIC', () => {
      const info = fnInfo('public.get_sdr_leads_abertos_v2(integer,integer,text)');
      expect(info).toMatchObject({
        args: 'p_year integer, p_month integer, p_api_token text',
        definer: true,
        volatile: 's',
        config: ['search_path=""'],
        public: false,
        anon: true,
        authenticated: true,
        service_role: true,
        overloads: 1,
      });
    });

    it('legada: corpo, assinatura e permissões intactos depois da migration', () => {
      const after = fnInfo('public.get_sdr_leads_abertos(integer,integer)');
      expect(after).toEqual(legacyBefore);
      expect(after).toMatchObject({
        md5: PROD_MD5.legacy,
        args: 'p_year integer, p_month integer',
        public: true,
        anon: true,
        overloads: 1,
      });
    });

    it('legada continua aberta a anon sem token (exposição NÃO encerrada por este PR)', () => {
      expect(as({ kind: 'anon' }, legacy(2026, 10))).toEqual(
        as({ kind: 'service_role' }, legacy(2026, 10)),
      );
    });
  });
});
