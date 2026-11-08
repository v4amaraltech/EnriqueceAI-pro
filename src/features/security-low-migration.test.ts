import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261108170000_security_low.sql'), 'utf8');

describe('migration 20261108170000_security_low', () => {
  it('é transacional', () => {
    expect(sql).toMatch(/^BEGIN;/m);
    expect(sql).toMatch(/^COMMIT;/m);
  });

  it('todo CREATE POLICY é precedido de DROP POLICY IF EXISTS', () => {
    const creates = [...sql.matchAll(/CREATE POLICY\s+("[^"]+"|\w+)\s+ON\s+([\w.]+)/g)];
    expect(creates.length).toBeGreaterThan(0);
    for (const [, name, table] of creates) {
      expect(sql).toContain(`DROP POLICY IF EXISTS ${name} ON ${table}`);
    }
  });

  it('pista 25: templates, loss_reasons e reminder_steps exigem gerente ou autoria', () => {
    expect(sql).toMatch(/templates_org_update[\s\S]*is_system = false AND created_by = \(SELECT auth\.uid\(\)\)/);
    expect(sql).toMatch(/loss_reasons_insert_own_org[\s\S]*is_manager\(\)/);
    expect(sql).toMatch(/loss_reasons_delete_own_org[\s\S]*is_manager\(\)/);
    expect(sql).toMatch(/rs_org_write ON public\.reminder_steps FOR ALL[\s\S]*is_manager\(\)/);
  });

  it('pista 26: as três policies de escrita do org-logos exigem is_manager e o bucket tem limites', () => {
    for (const n of ['upload', 'update', 'delete']) {
      const block = sql.match(new RegExp(`CREATE POLICY "Org members can ${n} logo"[\\s\\S]*?;\\n`));
      expect(block?.[0]).toMatch(/is_manager\(\)/);
    }
    expect(sql).toMatch(/allowed_mime_types = ARRAY\['image\/jpeg', 'image\/png', 'image\/webp'\]/);
    expect(sql).toMatch(/file_size_limit = 5242880/);
  });

  it('X1: remove só a sobrecarga de 1 argumento', () => {
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.get_calls_for_v4sales\(text\);/);
  });
});
