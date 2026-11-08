import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261108120000_security_high_fixes.sql'),
  'utf8',
);

describe('migration 20261108120000_security_high_fixes', () => {
  it('revoga ingest_callface_call e enriquecer_lead de anon/public/authenticated e concede só a service_role', () => {
    expect(sql).toMatch(/'ingest_callface_call', 'enriquecer_lead'/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION %s TO service_role/);
  });

  it('a policy de lead_contacts exige que o lead seja da org do usuário', () => {
    expect(sql).toMatch(/WITH CHECK \(\s*org_id = public\.user_org_id\(\)\s*AND public\.lead_belongs_to_user_org\(lead_id\)/);
  });

  it('as funções DEFINER conferem a org do lead', () => {
    expect(sql).toMatch(/AND l\.org_id = v_p\.org_id/);
    expect(sql).toMatch(/l\.id = v_lead_id AND l\.org_id = v_user_org/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_primary_lead_contact\(uuid\) FROM PUBLIC, anon/);
  });

  it('é idempotente e transacional', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toMatch(/DROP POLICY IF EXISTS lead_contacts_org/);
  });
});
