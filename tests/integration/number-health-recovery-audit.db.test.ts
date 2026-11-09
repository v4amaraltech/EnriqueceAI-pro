import { execFileSync, execFile } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const DB = 'nh_recovery_contract';
const root = resolve(__dirname, '../..');

function psqlAvailable(): boolean {
  try {
    execFileSync('sudo', ['-u', 'postgres', 'psql', '-d', 'postgres', '-c', 'SELECT 1'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function psql(database: string, args: string[], sql?: string): string {
  const full = ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', ...args];
  if (sql !== undefined) full.push('-c', sql);
  return execFileSync('sudo', full, { encoding: 'utf8', cwd: root });
}

function psqlAsync(database: string, sql: string): Promise<string> {
  return execFileAsync('sudo', ['-u', 'postgres', 'psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-t', '-A', '-c', sql], {
    encoding: 'utf8',
    cwd: root,
  }).then((out) => out.stdout);
}

const canRun = psqlAvailable();

describe.skipIf(!canRun)('auditoria de recuperacao no Postgres com as migrations do repositorio', () => {
  it('aplica os arquivos exatos e cobre rollback, replay, conflito, RLS e FKs', () => {
    psql('postgres', ['-c', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid()`]);
    psql('postgres', ['-c', `DROP DATABASE IF EXISTS ${DB}`]);
    psql('postgres', ['-c', `CREATE DATABASE ${DB}`]);
    psql(DB, ['-f', 'tests/integration/sql/number-health-recovery-prereq.sql']);
    psql(DB, ['-f', 'supabase/migrations/20261108200000_number_health_recovery_audit.sql']);
    psql(DB, ['-f', 'supabase/migrations/20261109120000_number_health_recovery_contract.sql']);
    const out = psql(DB, ['-f', 'tests/integration/sql/number-health-recovery-assertions.sql']);
    expect(out).not.toMatch(/ERROR/);
  }, 60_000);

  it('duas sessoes com o mesmo pedido geram uma auditoria e um replay', async () => {
    const call = `SELECT public.authorize_number_recovery_with_audit(
      '11111111-1111-4111-8111-111111111111',
      '99999999-9999-4999-8999-999999999995',
      '33333333-3333-4333-8333-333333333333',
      'duas sessoes no mesmo episodio',
      '18181818-1818-4181-8181-181818181818',
      '2026-11-12 15:00:00+00',
      '2026-11-08 23:00:00+00'
    )`;
    const [a, b] = await Promise.all([psqlAsync(DB, call), psqlAsync(DB, call)]);
    const rows = [JSON.parse(a), JSON.parse(b)] as Array<{ success: boolean; replay: boolean; error?: string }>;
    expect(rows.every((row) => row.success === true)).toBe(true);
    expect(rows.filter((row) => row.replay === true)).toHaveLength(1);
    expect(rows.filter((row) => row.replay === false)).toHaveLength(1);
    const count = psql(DB, ['-t', '-A', '-c', `SELECT count(*) FROM public.whatsapp_number_health_recoveries WHERE instance_id = '99999999-9999-4999-8999-999999999995'`]);
    expect(count.trim()).toBe('1');
    const state = psql(DB, ['-t', '-A', '-c', `SELECT health_state FROM public.whatsapp_instances WHERE id = '99999999-9999-4999-8999-999999999995'`]);
    expect(state.trim()).toBe('warming');
  }, 30_000);

  it('sessao que segura o episodio antigo nao recupera a pausa nova', async () => {
    const holder = psqlAsync(
      DB,
      `BEGIN;
       SELECT id FROM public.whatsapp_instances WHERE id = '99999999-9999-4999-8999-999999999996' FOR UPDATE;
       UPDATE public.test_barrier SET ready = true WHERE id = 1;
       SELECT pg_sleep(2);
       UPDATE public.whatsapp_instances
          SET health_state_changed_at = '2026-11-09 23:30:00+00',
              health_pause_reason = 'failure_rate_high'
        WHERE id = '99999999-9999-4999-8999-999999999996';
       COMMIT;`,
    );
    const started = Date.now();
    let ready = false;
    while (!ready && Date.now() - started < 5000) {
      const value = await psqlAsync(DB, 'SELECT ready FROM public.test_barrier WHERE id = 1');
      ready = value.trim() === 't' || value.trim() === 'true';
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(ready).toBe(true);
    const stale = psqlAsync(
      DB,
      `SELECT public.authorize_number_recovery_with_audit(
        '11111111-1111-4111-8111-111111111111',
        '99999999-9999-4999-8999-999999999996',
        '33333333-3333-4333-8333-333333333333',
        'pedido que viu a pausa anterior',
        '19191919-1919-4191-8191-191919191919',
        '2026-11-12 15:00:00+00',
        '2026-11-08 23:30:00+00'
      )`,
    );
    const [, raw] = await Promise.all([holder, stale]);
    const result = JSON.parse(raw) as { success: boolean; error?: string };
    expect(result).toMatchObject({ success: false, error: 'stale_episode' });
    const row = psql(
      DB,
      ['-t', '-A', '-c', `SELECT health_state || '|' || health_state_changed_at::text || '|' || (SELECT count(*) FROM public.whatsapp_number_health_recoveries WHERE instance_id = '99999999-9999-4999-8999-999999999996') FROM public.whatsapp_instances WHERE id = '99999999-9999-4999-8999-999999999996'`],
    );
    expect(row.trim().startsWith('paused|')).toBe(true);
    expect(row.trim().endsWith('|0')).toBe(true);
  }, 30_000);
});
