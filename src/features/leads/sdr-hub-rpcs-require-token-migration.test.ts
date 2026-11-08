import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261108180000_sdr_hub_rpcs_require_token.sql'),
  'utf8',
);
/** Só o código, sem comentários (o cabeçalho cita o ramo antigo e o rollback). */
const code = sql.replace(/--[^\n]*/g, '');

describe('migration 20261108180000_sdr_hub_rpcs_require_token (fase 2)', () => {
  it('remove o ramo de transição: anon sem token não passa mais', () => {
    expect(code).not.toMatch(/auth\.role\(\)\s*=\s*'anon'/);
    expect(code).not.toMatch(/RAISE WARNING/);
    expect(code.match(/RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'/g)).toHaveLength(4);
  });

  it('mexe só nas duas RPCs, com a mesma assinatura e sem DROP', () => {
    expect(code).not.toMatch(/DROP FUNCTION/i);
    const created = [...code.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(created).toEqual(['get_sdr_atividades_atrasadas_v4', 'get_sdr_leads_para_abrir_v2']);
    expect(code.match(/p_org_id uuid,\s+p_api_token text DEFAULT NULL\s*\)/g)).toHaveLength(2);
    expect(code.match(/STABLE SECURITY DEFINER/g)).toHaveLength(2);
    expect(code).not.toMatch(/get_sdr_leads_abertos|get_leads_for_v4sales|indicac/i);
  });

  it('mantém service_role, própria org e token válido só para a org V4', () => {
    expect(code.match(/auth\.role\(\) IS DISTINCT FROM 'service_role'/g)).toHaveLength(2);
    expect(code.match(/p_org_id IS DISTINCT FROM public\.user_org_id\(\)/g)).toHaveLength(2);
    expect(code.match(/p_org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'::uuid/g)).toHaveLength(2);
    expect(code.match(/verify_api_secret\('v4sales_public_rpc', p_api_token\)/g)).toHaveLength(2);
  });

  it('anon mantém EXECUTE (proxy usa chave anon + token); PUBLIC não', () => {
    for (const fn of ['get_sdr_atividades_atrasadas_v4', 'get_sdr_leads_para_abrir_v2']) {
      expect(code).toMatch(
        new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\(uuid, text\\) FROM PUBLIC;`),
      );
      expect(code).toMatch(
        new RegExp(
          `GRANT EXECUTE ON FUNCTION public\\.${fn}\\(uuid, text\\)\\s+TO anon, authenticated, service_role;`,
        ),
      );
    }
    expect(code).not.toMatch(/REVOKE[^;]*FROM[^;]*anon/);
  });

  it('não contém token nem hash', () => {
    expect(sql).not.toMatch(/[0-9a-f]{64}/i);
    expect(code).not.toMatch(/api_secrets/);
  });

  it('é transacional', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });
});
