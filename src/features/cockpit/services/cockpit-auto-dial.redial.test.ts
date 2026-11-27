import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeAutoDialClient, type AutoDialDb, type Row } from './auto-dial.testkit';
import { checkDialGate } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({ isCockpitAutoDialEnabled: vi.fn(), isCockpitAutoDialLive: vi.fn() }));

import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ORG = 'org-1';
const ME = 'user-1';
const MOTOR = { cockpit_auto_dial: { attempt_no: 1 } };

const lead = (over: Row = {}): Row => ({
  id: 'A', org_id: ORG, assigned_to: ME, closer_id: null, deleted_at: null, status: 'contacted', telefone: '11999990000', lost_at: null, loss_reason_id: null, ...over,
});
/** A ligação que caiu: atendida há 5 min, para o número do contato indicado, sem o aviso de término ainda. */
const dropped = (over: Row = {}): Row => ({
  id: 'prev', org_id: ORG, user_id: ME, lead_id: 'A', created_at: ago(5), started_at: ago(5), answered_at: ago(4), hangup_cause: null,
  duration_seconds: 0, status: 'not_connected', sdr_disposition: null, metadata: MOTOR, destination: '11988887777', contact_id: 'contact-9', ...over,
});

let db: AutoDialDb;
function setup(tables: Record<string, Row[]> = {}) {
  db = {
    tables: { leads: [lead()], calls: [dropped()], contact_holds: [], scheduled_activities: [], loss_reasons: [], business_holidays: [], interactions: [], ...tables },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(),
  };
  return makeAutoDialClient(db) as never;
}
const redial = (client: never, over: Partial<Parameters<typeof checkDialGate>[0]> = {}) =>
  checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: NOW, redialOf: 'prev', client, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(true);
});

describe('portão: "Ligar de novo"', () => {
  it('libera para o MESMO número e contato, apesar de atendido hoje, 1 h, e da própria ligação sem término', async () => {
    const client = setup();
    expect(await checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: NOW, client })).toMatchObject({ ok: false });
    expect(await redial(client)).toEqual({ ok: true, live: true, phone: '11988887777', contactId: 'contact-9', attemptNo: 2, leadId: 'A' });
    expect(db.writes).toEqual([]);
  });

  it('ignora o limite de 3 por dia, retorno futuro e conversa sem ação', async () => {
    const calls = [
      dropped({ sdr_disposition: 'answered_no_progress' }),
      ...[1, 2, 3].map((i) => dropped({ id: `old-${i}`, created_at: ago(30 + i), started_at: ago(30 + i), answered_at: null, hangup_cause: 'NO_ANSWER' })),
    ];
    const returns = [{ lead_id: 'A', org_id: ORG, status: 'pending', channel: 'phone', kind: 'return', scheduled_at: ago(-60 * 24) }];
    expect(await redial(setup({ calls, scheduled_activities: returns }))).toMatchObject({ ok: true });
  });

  it('recusa sem ligação anterior válida: de outro usuário, de outro lead, de outra org, fora do motor, ou com mais de 60 min', async () => {
    for (const over of [{ user_id: 'outro' }, { lead_id: 'B' }, { org_id: 'org-2' }, { metadata: {} }, { created_at: ago(61), started_at: ago(61) }]) {
      expect(await redial(setup({ calls: [dropped(over)] }))).toEqual({ ok: false, code: 'redial_unavailable' });
    }
    expect(await redial(setup(), { redialOf: 'inventada' })).toEqual({ ok: false, code: 'redial_unavailable' });
  });

  it('ligação que NÃO foi atendida não abre a exceção; religação não atendida mantém a exceção pela conversa anterior', async () => {
    const missed = dropped({ answered_at: null, hangup_cause: 'NO_ANSWER' });
    expect(await redial(setup({ calls: [missed] }))).toEqual({ ok: false, code: 'redial_unavailable' });
    const again = { ...missed, id: 're-1', created_at: ago(2), started_at: ago(2) };
    const client = setup({ calls: [dropped({ hangup_cause: 'NORMAL_CLEARING' }), again] });
    expect(await redial(client, { redialOf: 're-1' })).toMatchObject({ ok: true });
  });

  it('disparo duplo continua barrado: ligação mais nova (outra aba, outro lead, ou há menos de 20 s)', async () => {
    const newer = dropped({ id: 'nova', created_at: ago(0.1), started_at: ago(0.1), answered_at: null });
    expect(await redial(setup({ calls: [dropped(), newer] }))).toEqual({ ok: false, code: 'too_soon' });
    const other = dropped({ id: 'outra', lead_id: 'Z', created_at: ago(3), started_at: ago(3), answered_at: null });
    expect(await redial(setup({ calls: [dropped(), other] }))).toEqual({ ok: false, code: 'too_soon' });
  });

  it('mantém flags, janela, feriado, teto, dono, bloqueio, status e motivo de perda', async () => {
    vi.mocked(isCockpitAutoDialEnabled).mockResolvedValueOnce(false);
    expect(await redial(setup())).toEqual({ ok: false, code: 'flag_off' });
    expect(await redial(setup(), { holidays: ['2026-11-13'] })).toEqual({ ok: false, code: 'holiday' });
    const night = new Date('2026-11-13T23:30:00Z');
    expect(await redial(setup({ calls: [dropped({ created_at: '2026-11-13T23:20:00Z' })] }), { now: night })).toEqual({ ok: false, code: 'outside_hours' });
    const cap = Array.from({ length: 400 }, (_, i) => dropped({ id: `m${i}`, lead_id: 'Z', hangup_cause: 'NO_ANSWER' }));
    expect(await redial(setup({ calls: [dropped(), ...cap] }))).toEqual({ ok: false, code: 'daily_cap' });
    expect(await redial(setup({ leads: [lead({ assigned_to: 'outro' })] }))).toEqual({ ok: false, code: 'not_owner' });
    expect(await redial(setup({ contact_holds: [{ lead_id: 'A', org_id: ORG, tipo: 'total' }] }))).toEqual({ ok: false, code: 'held' });
    for (const status of ['unqualified', 'archived', 'won', 'qualified']) {
      expect(await redial(setup({ leads: [lead({ status })] }))).toEqual({ ok: false, code: 'lead_unavailable' });
    }
    const reasons = [{ id: 'r1', org_id: ORG, name: 'Blocklist' }];
    expect(await redial(setup({ leads: [lead({ loss_reason_id: 'r1' })], loss_reasons: reasons }))).toEqual({ ok: false, code: 'lead_unavailable' });
  });

  it('qualificado com o retorno vencido que a própria ligação consumiu pode religar', async () => {
    const returns = [{ lead_id: 'A', org_id: ORG, status: 'pending', channel: 'phone', kind: 'return', scheduled_at: ago(10) }];
    expect(await redial(setup({ leads: [lead({ status: 'qualified' })], scheduled_activities: returns }))).toMatchObject({ ok: true });
  });

  it('recuperação: conversa depois da perda não barra a religação', async () => {
    const lost = lead({ status: 'unqualified', lost_at: ago(60 * 24 * 30) });
    expect(await redial(setup({ leads: [lost] }), { queue: 'recovery' })).toMatchObject({ ok: true });
  });

  it('erro ao ler as ligações = não disca', async () => {
    const client = setup();
    db.failReads.add('calls');
    expect(await redial(client)).toEqual({ ok: false, code: 'error' });
  });
});
