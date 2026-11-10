import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261110190000_lead_channel_chat_flag.sql'),
  'utf8',
);

describe('flag da conversa do lead', () => {
  it('nasce desligada, com listas vazias, e não reescreve uma linha existente', () => {
    expect(sql).toContain("'lead_channel_chat'");
    expect(sql).toMatch(/'lead_channel_chat',\s*false,/);
    expect(sql).toContain("'{}'");
    expect(sql).toContain('ON CONFLICT (key) DO NOTHING');
    expect(sql).not.toContain('CREATE TABLE');
    expect(sql).not.toContain('DELETE FROM');
    expect(sql).not.toContain('UPDATE public.app_flags');
    expect(sql).not.toMatch(/[—–]/);
  });
});
