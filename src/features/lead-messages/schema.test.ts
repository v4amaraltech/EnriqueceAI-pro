import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261110210000_lead_messages.sql'),
  'utf8',
);

describe('tabela de conversas do lead', () => {
  it('nasce com a flag desligada e não mexe em interactions', () => {
    expect(sql).toContain("'lead_messages_capture'");
    expect(sql).toMatch(/'lead_messages_capture',\s*false,/);
    expect(sql).toContain("'{}'");
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toMatch(/ALTER TABLE public\.interactions/i);
    expect(sql).not.toMatch(/DROP POLICY[\s\S]*interactions/i);
    expect(sql).not.toMatch(/DELETE FROM public\.interactions/i);
    expect(sql).not.toMatch(/[—–]/);
  });

  it('é idempotente por org, provedor e id da mensagem', () => {
    expect(sql).toContain('UNIQUE (org_id, provider, provider_message_id)');
    expect(sql).toContain("CHECK (channel IN ('whatsapp', 'email'))");
    expect(sql).toContain("CHECK (direction IN ('inbound', 'outbound'))");
    expect(sql).toContain("'evolution', 'meta', 'gmail', 'ana_n8n', 'legacy_interactions'");
    expect(sql).toContain("CHECK (status IN ('sent', 'delivered', 'read', 'failed'))");
    expect(sql).toContain('UNIQUE (message_id, status)');
  });

  it('recusa alterar ou apagar o corpo e a mídia não guarda arquivo', () => {
    expect(sql).toContain('lead_messages body is append-only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.lead_messages');
    expect(sql).toContain('lead_message_status_events is append-only');
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.lead_message_status_events');
    expect(sql).toContain("NOT (media ? 'url')");
    expect(sql).toContain("NOT (media ? 'base64')");
    expect(sql).not.toContain('storage.objects');
  });

  it('força RLS, lê como interactions e não abre para anon', () => {
    for (const table of ['lead_messages', 'lead_message_status_events', 'lead_message_unmatched']) {
      expect(sql).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE public.${table} FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${table} FROM PUBLIC, anon, authenticated`);
    }
    expect(sql).toContain('public.is_manager()');
    expect(sql).toContain("public.lead_visibility_mode()) = 'all'");
    expect(sql).toContain('EXISTS (SELECT 1 FROM public.leads l WHERE l.id = lead_messages.lead_id)');
    expect(sql).toContain('TO authenticated');
    expect(sql).not.toMatch(/TO anon/);
    expect(sql).not.toMatch(/FOR INSERT TO authenticated/);
    expect(sql).not.toMatch(/FOR UPDATE TO authenticated/);
    expect(sql).not.toMatch(/FOR DELETE TO authenticated/);
    expect(sql).toContain('GRANT SELECT, INSERT ON public.lead_messages TO service_role');
    expect(sql).not.toContain('GRANT UPDATE');
    expect(sql).not.toContain('GRANT DELETE');
  });
});
