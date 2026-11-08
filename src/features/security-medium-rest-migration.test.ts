import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261108150000_security_medium_rest.sql'), 'utf8');

describe('migration 20261108150000_security_medium_rest', () => {
  it('cria o índice único parcial de callface_call_id de forma idempotente', () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS uq_calls_callface_call_id\s+ON public\.calls \(\(metadata->>'callface_call_id'\)\)\s+WHERE metadata->>'callface_call_id' IS NOT NULL/,
    );
  });

  it('pista 10: troca o SELECT de tabela por grant de colunas sem o segredo', () => {
    expect(sql).toMatch(/'apollo_connections', 'api_key_encrypted'/);
    expect(sql).toMatch(/'api4com_org_settings', 'api_key_encrypted'/);
    expect(sql).toMatch(/REVOKE SELECT ON public\.%I FROM anon, authenticated/);
    expect(sql).toMatch(/GRANT SELECT \(%s\) ON public\.%I TO authenticated/);
  });

  it('pista 13: trigger compara a org do lead com a da interação', () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF lead_id, org_id ON public\.interactions/);
    expect(sql).toMatch(/v_lead_org IS DISTINCT FROM NEW\.org_id/);
  });

  it('pista 24: remove escrita de ai_usage e protege whatsapp_credits', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_usage_org_insert/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS ai_usage_org_update/);
    expect(sql).toMatch(/NEW\.used_credits < OLD\.used_credits/);
    expect(sql).toMatch(/NEW\.plan_credits IS DISTINCT FROM OLD\.plan_credits/);
  });

  it('pista 27: lead_contacts e interactions herdam a visibilidade de leads', () => {
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.leads l WHERE l\.id = lead_contacts\.lead_id\)/);
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.leads l WHERE l\.id = interactions\.lead_id\)/);
  });

  it('é transacional e não repete CREATE POLICY sem DROP', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
    expect(sql).toMatch(/DROP POLICY IF EXISTS lead_contacts_org/);
    expect(sql).toMatch(/DROP POLICY IF EXISTS interactions_org_read/);
  });
});
