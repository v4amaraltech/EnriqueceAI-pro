import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate, loadMotorHolidays } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const agoSec = (s: number) => new Date(NOW.getTime() - s * 1000).toISOString();
const ORG = 'org-1';
const ME = 'user-1';

const lead = (over: Row = {}): Row => ({
  id: 'A', org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000', lost_at: null, loss_reason_id: null, ...over,
});
const call = (over: Row = {}): Row => ({
  id: `c-${Math.random()}`, org_id: ORG, user_id: ME, lead_id: 'Z', created_at: agoSec(600), started_at: agoSec(600), answered_at: null,
  hangup_cause: 'NORMAL_CLEARING', duration_seconds: 0, sdr_disposition: null, metadata: {}, ...over,
});

let db: AutoDialDb;
function setup(tables: Record<string, Row[]> = {}) {
  db = {
    tables: { leads: [lead()], calls: [], contact_holds: [], scheduled_activities: [], loss_reasons: [], business_holidays: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(),
  };
  return makeAutoDialClient(db) as never;
}
const gate = (client: never, at: Date = NOW) => checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: at, client });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});

describe('portão: trava suave too_soon (item 3a)', () => {
  it('ligação do próprio usuário criada há menos de 20 s (qualquer origem) recusa', async () => {
    expect(await gate(setup({ calls: [call({ created_at: agoSec(8), started_at: agoSec(8) })] }))).toEqual({ ok: false, code: 'too_soon' });
    expect(await gate(setup({ calls: [call({ created_at: agoSec(20), started_at: agoSec(20) })] }))).toMatchObject({ ok: true });
  });

  it('ligação DO MOTOR sem término (hangup_cause vazio) recusa; depois que termina, libera; sem término e antiga (>20 min), libera', async () => {
    const motorOpen = call({ created_at: agoSec(120), started_at: agoSec(120), hangup_cause: null, metadata: { cockpit_auto_dial: { attempt_no: 1 } } });
    expect(await gate(setup({ calls: [motorOpen] }))).toEqual({ ok: false, code: 'too_soon' });
    expect(await gate(setup({ calls: [{ ...motorOpen, hangup_cause: 'NORMAL_CLEARING' }] }))).toMatchObject({ ok: true });
    expect(await gate(setup({ calls: [{ ...motorOpen, created_at: agoSec(21 * 60), started_at: agoSec(21 * 60) }] }))).toMatchObject({ ok: true });
  });

  it('ligação de OUTRO usuário e de outra organização não trava', async () => {
    expect(await gate(setup({ calls: [call({ created_at: agoSec(3), user_id: 'outro' })] }))).toMatchObject({ ok: true });
    expect(await gate(setup({ calls: [call({ created_at: agoSec(3), org_id: 'org-2' })] }))).toMatchObject({ ok: true });
  });

  it('erro de leitura das ligações recentes = não disca; vem DEPOIS do teto e ANTES das leituras do lead', async () => {
    const client = setup();
    db.failReads.add('calls');
    expect(await gate(client)).toEqual({ ok: false, code: 'error' });
    const motor = Array.from({ length: 400 }, (_, i) => call({ id: `m${i}`, started_at: agoSec(3000), created_at: agoSec(3000), metadata: { cockpit_auto_dial: {} } }));
    expect(await gate(setup({ calls: [...motor, call({ created_at: agoSec(2) })] }))).toEqual({ ok: false, code: 'daily_cap' });
  });

  it('duas discagens quase juntas: a segunda vê a linha criada pela primeira e recusa', async () => {
    const client = setup();
    expect(await gate(client)).toMatchObject({ ok: true });
    db.tables.calls!.push(call({ created_at: NOW.toISOString(), started_at: NOW.toISOString(), hangup_cause: null, metadata: { cockpit_auto_dial: {} } }));
    expect(await gate(client)).toEqual({ ok: false, code: 'too_soon' });
  });
});

describe('feriados: lista nacional fixa UNIDA a business_holidays (item 6)', () => {
  it('loadMotorHolidays: união da lista fixa com a tabela (a tabela é global, sem org_id)', async () => {
    const client = setup({ business_holidays: [{ holiday_date: '2026-11-17' }, { holiday_date: '2026-12-24T00:00:00+00:00' }] });
    const set = await loadMotorHolidays(client);
    expect(set.has('2026-11-17')).toBe(true); // só na tabela
    expect(set.has('2026-12-24')).toBe(true); // data com hora é cortada
    expect(set.has('2026-11-20')).toBe(true); // só na lista fixa
  });

  it('erro de leitura da tabela: só a lista fixa (feriado nacional continua bloqueando)', async () => {
    const client = setup({ business_holidays: [{ holiday_date: '2026-11-17' }] });
    db.failReads.add('business_holidays');
    const set = await loadMotorHolidays(client);
    expect(set.has('2026-11-17')).toBe(false);
    expect(set.has('2026-11-20')).toBe(true);
    expect(await gate(client, new Date('2026-11-20T15:00:00Z'))).toEqual({ ok: false, code: 'holiday' });
  });

  it('o portão recusa feriado que só existe em business_holidays (terça 17/11)', async () => {
    const client = setup({ business_holidays: [{ holiday_date: '2026-11-17' }] });
    expect(await gate(client, new Date('2026-11-17T15:00:00Z'))).toEqual({ ok: false, code: 'holiday' });
    expect(await gate(setup(), new Date('2026-11-17T15:00:00Z'))).toMatchObject({ ok: true });
  });

  it('o portão recusa feriado nacional fixo mesmo com a tabela vazia', async () => {
    expect(await gate(setup(), new Date('2026-11-20T15:00:00Z'))).toEqual({ ok: false, code: 'holiday' });
  });

  it('só lê a tabela de feriados depois de a flag liberar (flag desligada não lê nada)', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(false);
    const client = setup();
    expect(await gate(client)).toEqual({ ok: false, code: 'flag_off' });
    expect(db.reads).toEqual([]);
  });
});
