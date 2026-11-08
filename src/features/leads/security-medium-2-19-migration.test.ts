import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261108130000_security_medium_2_19.sql'),
  'utf8',
);

describe('migration 20261108130000_security_medium_2_19', () => {
  it('pista 19: remove a policy USING (true) e o acesso de authenticated/anon a worker_run_state', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS worker_run_state_select_authenticated ON public\.worker_run_state/);
    expect(sql).toMatch(/REVOKE ALL ON public\.worker_run_state FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT ALL ON public\.worker_run_state TO service_role/);
    expect(sql).not.toMatch(/CREATE POLICY worker_run_state/);
  });

  it('pista 2: get_sdr_atividades_atrasadas_v2 fica só para service_role', () => {
    expect(sql).toMatch(/p\.proname = 'get_sdr_atividades_atrasadas_v2'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it('pista 2: v4 e abrir_v2 dropam a assinatura antiga (sem sobrecarga exposta) e checam o chamador', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_sdr_atividades_atrasadas_v4\(uuid\)/);
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_sdr_leads_para_abrir_v2\(uuid\)/);
    expect(sql.match(/p_org_id IS DISTINCT FROM public\.user_org_id\(\)/g)).toHaveLength(2);
    expect(sql.match(/verify_api_secret\('v4sales_public_rpc', p_api_token\)/g)).toHaveLength(2);
    expect(sql.match(/RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'/g)!.length).toBeGreaterThanOrEqual(4);
  });

  it('pista 2: mantém anon sem token na transição (Sales Hub) com WARNING, e nega authenticated de outra org', () => {
    expect(sql).toMatch(/ELSIF auth\.role\(\) = 'anon' THEN\s+-- Transição[^\n]*\n\s+RAISE WARNING/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_sdr_atividades_atrasadas_v4\(uuid, text\)\s+TO anon, authenticated, service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.get_sdr_leads_para_abrir_v2\(uuid, text\) FROM PUBLIC/);
  });

  it('é transacional', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });
});
