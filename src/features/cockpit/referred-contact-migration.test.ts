import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');
const sql = (text: string) => text.replace(/--.*$/gm, '');
const functionBody = (text: string) => text.slice(text.indexOf('CREATE OR REPLACE FUNCTION'));

const enumSql = sql(read('20261126120000_call_disposition_add_referred_contact.sql'));
const previous = read('20261116132051_cockpit_recovery_candidates.sql');
const next = read('20261126120100_cockpit_recovery_candidates_referred_contact.sql');

describe('migrations do desfecho referred_contact', () => {
  it('adiciona o valor ao enum fora de transação', () => {
    expect(enumSql).toContain("ALTER TYPE public.call_disposition ADD VALUE IF NOT EXISTS 'referred_contact';");
    expect(enumSql).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
  });

  it('a função de recuperação só muda nas 3 listas de desfechos, sem DROP e com os mesmos grants', () => {
    expect(sql(next)).not.toMatch(/\bDROP\b/);
    expect(functionBody(next).match(/'referred_contact'/g)).toHaveLength(3);
    expect(functionBody(next).replaceAll(", 'referred_contact'", '')).toBe(functionBody(previous));
  });
});
