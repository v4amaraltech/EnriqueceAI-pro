import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261108190000_get_sdr_leads_abertos_v2_token.sql'),
  'utf8',
);
/** Só o código, sem comentários (o cabeçalho cita a legada, o rollback etc.). */
const code = sql.replace(/--[^\n]*/g, '');

describe('migration 20261108190000_get_sdr_leads_abertos_v2_token', () => {
  it('é aditiva: só cria a _v2 e não toca na legada', () => {
    const created = [...code.matchAll(/CREATE OR REPLACE FUNCTION\s+public\.(\w+)\(/g)].map(
      (m) => m[1],
    );
    expect(created).toEqual(['get_sdr_leads_abertos_v2']);
    expect(code).not.toMatch(/DROP\s/i);
    expect(code).not.toMatch(/get_sdr_leads_abertos\s*\(/);
    expect(code).not.toMatch(/ON FUNCTION public\.get_sdr_leads_abertos\(/);
  });

  it('assinatura com token obrigatório (sem DEFAULT) e sem parâmetro de org', () => {
    expect(code).toMatch(
      /get_sdr_leads_abertos_v2\(\s*p_year integer,\s*p_month integer,\s*p_api_token text\s*\)/,
    );
    expect(code).not.toMatch(/DEFAULT/i);
    expect(code).not.toMatch(/p_org_id/);
    expect(code).toMatch(/v_org\s+uuid := 'c2727473-1df8-4faa-9264-a9fc1759fe3b';/);
    expect(code).toMatch(/v_tz\s+text := 'America\/Sao_Paulo';/);
  });

  it('SECURITY DEFINER com search_path vazio e referências qualificadas', () => {
    expect(code).toMatch(/STABLE\s+SECURITY DEFINER\s+SET search_path = ''/);
    expect(code).toMatch(/FROM public\.leads_opened_events\(v_org, NULL\)/);
    expect(code).toMatch(/JOIN public\.organization_members m/);
    expect(code).toMatch(/LEFT JOIN auth\.users u/);
    const body = code.split('$function$')[1] ?? '';
    expect(body).toMatch(/RETURN v_result;/);
    expect(body).not.toMatch(
      /((?<!DISTINCT\s)FROM|JOIN)\s+(?!public\.|auth\.|ev\b|firsts\b|\()[a-z_]+/i,
    );
  });

  it('autoriza só service_role, org V4 ou token válido; senão 42501', () => {
    expect(code).toMatch(/auth\.role\(\) IS DISTINCT FROM 'service_role'/);
    expect(code).toMatch(/public\.user_org_id\(\) IS DISTINCT FROM v_org/);
    expect(code).toMatch(/p_api_token IS NOT NULL\s+AND p_api_token <> ''/);
    expect(code).toMatch(/public\.verify_api_secret\('v4sales_public_rpc', p_api_token\)/);
    expect(code).toMatch(/RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501'/);
    // a checagem vem antes de qualquer cálculo
    expect(code.indexOf("RAISE EXCEPTION 'Forbidden'")).toBeLessThan(code.indexOf('make_date('));
  });

  it('EXECUTE: tira de PUBLIC e dá a anon, authenticated e service_role', () => {
    expect(code).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_sdr_leads_abertos_v2\(integer, integer, text\) FROM PUBLIC;/,
    );
    expect(code).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_sdr_leads_abertos_v2\(integer, integer, text\)\s+TO anon, authenticated, service_role;/,
    );
  });

  it('não contém token nem hash', () => {
    expect(sql).not.toMatch(/[0-9a-f]{40,}/i);
    expect(code).not.toMatch(/api_secrets/);
  });

  it('é transacional', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });
});
