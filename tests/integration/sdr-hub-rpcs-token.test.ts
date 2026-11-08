// @vitest-environment node
/**
 * Quem pode chamar get_sdr_atividades_atrasadas_v4 e get_sdr_leads_para_abrir_v2
 * num Postgres de verdade (story sales-hub-sdr-rpcs-token, fase 2).
 *
 * Aplica a fixture mínima, a migration da fase 1 (20261108130000) e a da fase 2
 * (20261108180000) COMO ESTÃO, na ordem de prod. O token é fictício, gerado aqui;
 * só o hash vai para o banco descartável.
 *
 * Roda só com STATS_TEST_PG_URL apontando para um Postgres LOCAL (superusuário).
 * STATS_TEST_PSQL = comando do psql (padrão `psql`; na máquina do dev:
 * `docker exec -i supabase_db_flux psql`).
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
const DB = `sdr_hub_rpcs_it_${randomBytes(4).toString('hex')}`;

const FIXTURE = 'tests/integration/fixtures/sdr-hub-rpcs-schema.sql';
const PHASE1 = 'supabase/migrations/20261108130000_security_medium_2_19.sql';
const PHASE2 = 'supabase/migrations/20261108180000_sdr_hub_rpcs_require_token.sql';

/** md5 de pg_get_functiondef em prod, 2026-11-08. */
const PROD_MD5_USER_ORG_ID = '6926a8470a00bcb575394b8166e2591a';

const TOKEN = `token-ficticio-${randomBytes(12).toString('hex')}`;
const WRONG_TOKEN = `token-errado-${randomBytes(12).toString('hex')}`;

const V4_ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const OTHER_ORG = '00000000-0000-4000-8001-000000000002';
const V4_SDR = '00000000-0000-4000-8002-000000000001';
const OTHER_SDR = '00000000-0000-4000-8002-000000000002';

const FUNCS = [
  { name: 'get_sdr_atividades_atrasadas_v4', col: 'atrasadas' },
  { name: 'get_sdr_leads_para_abrir_v2', col: 'na_fila' },
] as const;

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

const lit = (v: string | null) => (v === null ? 'NULL' : `'${v.replace(/'/g, "''")}'`);

type Caller = { kind: 'anon' } | { kind: 'authenticated'; sub: string } | { kind: 'service_role' };

type CallResult =
  | { ok: true; rows: Array<{ email: string; n: number }> }
  | { ok: false; error: string };

/** Chama a RPC como o papel dado, numa transação desfeita no fim. */
function call(
  fn: string,
  col: string,
  caller: Caller,
  orgId: string,
  token: string | null | undefined,
): CallResult {
  const claims =
    caller.kind === 'authenticated'
      ? { role: 'authenticated', sub: caller.sub }
      : { role: caller.kind };
  const args = token === undefined ? `${lit(orgId)}::uuid` : `${lit(orgId)}::uuid, ${lit(token)}`;
  const r = psql(
    DB,
    `\\set VERBOSITY verbose
BEGIN;
SET LOCAL ROLE ${caller.kind};
SELECT set_config('request.jwt.claims', ${lit(JSON.stringify(claims))}, true);
SELECT coalesce(json_agg(json_build_object('email', r.email, 'n', r.${col})), '[]'::json)
  FROM public.${fn}(${args}) r;
ROLLBACK;`,
  );
  if (!r.ok) return { ok: false, error: r.err };
  const last = r.out.split('\n').pop() ?? '[]';
  return { ok: true, rows: JSON.parse(last) };
}

function expectForbidden(r: CallResult) {
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toMatch(/42501: Forbidden/);
}

let phase1AnonNoToken: Record<string, CallResult> = {};

describe.skipIf(!RUN)('RPCs do Sales Hub exigem token (fase 2)', () => {
  beforeAll(() => {
    psqlOrThrow('postgres', `CREATE DATABASE ${DB};`);
    psqlOrThrow(DB, fs.readFileSync(path.join(ROOT, FIXTURE), 'utf8'));
    psqlOrThrow(DB, fs.readFileSync(path.join(ROOT, PHASE1), 'utf8'));
    psqlOrThrow(
      DB,
      `INSERT INTO public.organizations (id) VALUES (${lit(V4_ORG)}), (${lit(OTHER_ORG)});
INSERT INTO auth.users (id, email) VALUES
  (${lit(V4_SDR)}, 'sdr.v4@example.test'), (${lit(OTHER_SDR)}, 'sdr.outra@example.test');
INSERT INTO public.organization_members (org_id, user_id, role, status, accepted_at) VALUES
  (${lit(V4_ORG)}, ${lit(V4_SDR)}, 'sdr', 'active', now()),
  (${lit(OTHER_ORG)}, ${lit(OTHER_SDR)}, 'sdr', 'active', now());
INSERT INTO public.leads (id, org_id, status, assigned_to) VALUES
  ('00000000-0000-4000-8010-000000000001', ${lit(V4_ORG)}, 'new', ${lit(V4_SDR)}),
  ('00000000-0000-4000-8010-000000000002', ${lit(V4_ORG)}, 'new', ${lit(V4_SDR)}),
  ('00000000-0000-4000-8010-000000000003', ${lit(OTHER_ORG)}, 'new', ${lit(OTHER_SDR)});
INSERT INTO public.api_secrets (name, token_hash)
  VALUES ('v4sales_public_rpc', encode(extensions.digest(${lit(TOKEN)}, 'sha256'), 'hex'));`,
    );
    // Retrato da fase 1: anon sem token ainda passava (só WARNING).
    phase1AnonNoToken = Object.fromEntries(
      FUNCS.map((f) => [f.name, call(f.name, f.col, { kind: 'anon' }, V4_ORG, undefined)]),
    );
    psqlOrThrow(DB, fs.readFileSync(path.join(ROOT, PHASE2), 'utf8'));
  });

  afterAll(() => {
    psql('postgres', `DROP DATABASE IF EXISTS ${DB} WITH (FORCE);`);
  });

  it('fixture: user_org_id() igual à de prod', () => {
    const md5 = psqlOrThrow(
      DB,
      `SELECT md5(pg_get_functiondef('public.user_org_id()'::regprocedure));`,
    );
    expect(md5).toBe(PROD_MD5_USER_ORG_ID);
  });

  describe.each(FUNCS)('$name', ({ name, col }) => {
    const V4_ROWS = [{ email: 'sdr.v4@example.test', n: 2 }];

    it('fase 1 (antes): anon sem token passava — é isso que a fase 2 fecha', () => {
      expect(phase1AnonNoToken[name]).toEqual({ ok: true, rows: V4_ROWS });
    });

    it('anon + token válido na org V4 → devolve os dados', () => {
      expect(call(name, col, { kind: 'anon' }, V4_ORG, TOKEN)).toEqual({ ok: true, rows: V4_ROWS });
    });

    it('anon + token inválido → 42501', () => {
      expectForbidden(call(name, col, { kind: 'anon' }, V4_ORG, WRONG_TOKEN));
    });

    it('anon + token vazio → 42501', () => {
      expectForbidden(call(name, col, { kind: 'anon' }, V4_ORG, ''));
    });

    it('anon sem token (parâmetro omitido) → 42501', () => {
      expectForbidden(call(name, col, { kind: 'anon' }, V4_ORG, undefined));
    });

    it('anon + token NULL explícito → 42501', () => {
      expectForbidden(call(name, col, { kind: 'anon' }, V4_ORG, null));
    });

    it('anon + token válido em org não permitida → 42501', () => {
      expectForbidden(call(name, col, { kind: 'anon' }, OTHER_ORG, TOKEN));
    });

    it('usuário logado da própria org, sem token → devolve os dados da org dele', () => {
      expect(
        call(name, col, { kind: 'authenticated', sub: OTHER_SDR }, OTHER_ORG, undefined),
      ).toEqual({
        ok: true,
        rows: [{ email: 'sdr.outra@example.test', n: 1 }],
      });
      expect(call(name, col, { kind: 'authenticated', sub: V4_SDR }, V4_ORG, undefined)).toEqual({
        ok: true,
        rows: V4_ROWS,
      });
    });

    it('usuário logado de outra org, sem token → 42501', () => {
      expectForbidden(
        call(name, col, { kind: 'authenticated', sub: OTHER_SDR }, V4_ORG, undefined),
      );
    });

    it('usuário logado de outra org + token válido em org não permitida → 42501', () => {
      expectForbidden(call(name, col, { kind: 'authenticated', sub: V4_SDR }, OTHER_ORG, TOKEN));
    });

    it('service_role sem token → devolve os dados de qualquer org', () => {
      expect(call(name, col, { kind: 'service_role' }, V4_ORG, undefined)).toEqual({
        ok: true,
        rows: V4_ROWS,
      });
      expect(call(name, col, { kind: 'service_role' }, OTHER_ORG, undefined)).toEqual({
        ok: true,
        rows: [{ email: 'sdr.outra@example.test', n: 1 }],
      });
    });

    it('assinatura, default, SECURITY DEFINER e EXECUTE preservados (anon mantém EXECUTE, PUBLIC não)', () => {
      const out = psqlOrThrow(
        DB,
        `SELECT json_build_object(
           'args', pg_get_function_arguments(p.oid),
           'definer', p.prosecdef,
           'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
           'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
           'service_role', has_function_privilege('service_role', p.oid, 'EXECUTE'),
           'public', EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0),
           'overloads', (SELECT count(*) FROM pg_proc q WHERE q.proname = p.proname)
         )
         FROM pg_proc p WHERE p.proname = ${lit(name)};`,
      );
      expect(JSON.parse(out)).toEqual({
        args: 'p_org_id uuid, p_api_token text DEFAULT NULL::text',
        definer: true,
        anon: true,
        authenticated: true,
        service_role: true,
        public: false,
        overloads: 1,
      });
    });
  });
});
