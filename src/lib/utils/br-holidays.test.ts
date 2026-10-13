import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BR_NATIONAL_HOLIDAYS, brtDateKey, isBrBusinessDay, isBrHoliday } from './br-holidays';

describe('br-holidays', () => {
  it('a lista do app bate com a tabela public.business_holidays das migrations', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(join(dir, f), 'utf8'))
      .filter((s) => s.includes('business_holidays'))
      .join('\n');
    const inDb = new Set([...sql.matchAll(/\('(\d{4}-\d{2}-\d{2})', '[^']+'\)/g)].map((m) => m[1]));
    expect([...inDb].sort()).toEqual(Object.keys(BR_NATIONAL_HOLIDAYS).sort());
  });

  it('feriado não é dia útil; fim de semana também não', () => {
    expect(isBrHoliday('2026-10-12')).toBe(true);
    expect(isBrBusinessDay('2026-10-12')).toBe(false); // seg, Nossa Senhora Aparecida
    expect(isBrBusinessDay('2026-10-13')).toBe(true); // ter
    expect(isBrBusinessDay('2026-10-17')).toBe(false); // sáb
    expect(isBrBusinessDay('2026-11-02')).toBe(false); // seg, Finados
  });

  it('brtDateKey usa o dia BRT, não o UTC', () => {
    expect(brtDateKey(new Date('2026-10-12T23:30:00-03:00'))).toBe('2026-10-12'); // 02:30 UTC do dia 13
  });
});
