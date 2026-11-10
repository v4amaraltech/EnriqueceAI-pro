import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261110143000_closer_calendar_connect.sql'),
  'utf8',
);

function grantBlock(table: string): string {
  const match = sql.match(new RegExp(`GRANT SELECT \\(([\\s\\S]*?)\\) ON public\\.${table} TO authenticated;`));
  return match?.[1] ?? '';
}

describe('permissões da agenda do closer', () => {
  it('a flag nasce desligada e a migration é aditiva', () => {
    expect(sql).toContain("'closer_calendar_connect'");
    expect(sql).toMatch(/'closer_calendar_connect',\s*false,/);
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.closer_calendar_connections');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.closer_calendar_invites');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.closer_calendar_events');
  });

  it('o gestor lê status, não o token nem o hash do convite', () => {
    for (const table of ['closer_calendar_connections', 'closer_calendar_invites', 'closer_calendar_events']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM anon, authenticated`);
    }
    expect(sql).toContain('public.is_manager()');
    const connections = grantBlock('closer_calendar_connections');
    expect(connections).toContain('status');
    expect(connections).toContain('calendar_email');
    expect(connections).not.toContain('access_token_encrypted');
    expect(connections).not.toContain('refresh_token_encrypted');
    const invites = grantBlock('closer_calendar_invites');
    expect(invites).toContain('expires_at');
    expect(invites).not.toContain('token_hash');
    expect(invites).not.toContain('oauth_state_hash');
    expect(sql).not.toMatch(/CREATE POLICY [\s\S]*FOR INSERT[\s\S]*closer_calendar_/);
    expect(sql).not.toMatch(/CREATE POLICY [\s\S]*FOR UPDATE[\s\S]*closer_calendar_/);
    expect(sql).not.toMatch(/CREATE POLICY [\s\S]*FOR DELETE[\s\S]*closer_calendar_/);
  });

  it('o histórico de convite e conexão não pode ser apagado nem alterado', () => {
    expect(sql).toContain('closer_calendar_events is append-only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.closer_calendar_events');
    expect(sql).not.toContain('DELETE FROM public.closer_calendar_events');
    expect(sql).not.toContain('GRANT INSERT');
    expect(sql).not.toContain('GRANT UPDATE');
    expect(sql).not.toContain('GRANT DELETE');
  });
});
