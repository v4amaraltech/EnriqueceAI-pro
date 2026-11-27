import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutoDialDb, type Row, makeAutoDialClient } from './auto-dial.testkit';
import { loadCallbackTarget, pickContactPhone } from './callback-contact.service';
import { isCockpitAutoDialEnabled, isCockpitAutoDialLive } from './cockpit-auto-dial-flag';
import { checkDialGate } from './cockpit-auto-dial.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./cockpit-auto-dial-flag', () => ({
  isCockpitAutoDialEnabled: vi.fn(),
  isCockpitAutoDialLive: vi.fn(),
}));

/** Sexta 13/11/2026 12:00 BRT. */
const NOW = new Date('2026-11-13T15:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ORG = 'org-1';
const ME = 'user-1';
const MAIN = '11999990000';
const INDICATED = '11988887777';

const ret = (over: Row = {}): Row => ({
  org_id: ORG,
  lead_id: 'A',
  channel: 'phone',
  kind: 'return',
  status: 'pending',
  scheduled_at: ago(30),
  contact_id: 'c-1',
  ...over,
});
const contact = (over: Row = {}): Row => ({
  id: 'c-1',
  org_id: ORG,
  lead_id: 'A',
  first_name: 'José',
  last_name: 'Lima',
  job_title: 'Sócio',
  phones: [{ tipo: 'whatsapp', numero: INDICATED }],
  ...over,
});
const lead = (over: Row = {}): Row => ({
  id: 'A',
  org_id: ORG,
  assigned_to: ME,
  closer_id: null,
  deleted_at: null,
  status: 'contacted',
  telefone: MAIN,
  ...over,
});

let db: AutoDialDb;
function setup(tables: Record<string, Row[]> = {}) {
  db = {
    tables: {
      calls: [],
      contact_holds: [],
      leads: [lead()],
      lead_contacts: [contact()],
      scheduled_activities: [ret()],
      ...tables,
    },
    failReads: new Set(),
    reads: [],
    writes: [],
    rpc: vi.fn(async () => ({ data: [], error: null })),
  };
  return makeAutoDialClient(db) as never;
}
const target = (client: never) => loadCallbackTarget({ orgId: ORG, leadId: 'A', now: NOW, client });
const gate = (client: never) =>
  checkDialGate({ orgId: ORG, userId: ME, leadId: 'A', now: NOW, client });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.mocked(isCockpitAutoDialEnabled).mockResolvedValue(true);
  vi.mocked(isCockpitAutoDialLive).mockResolvedValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe('pickContactPhone', () => {
  it('pega o primeiro número com DDD; ignora curto, vazio e formato estranho', () => {
    expect(pickContactPhone([{ numero: '9999' }, { numero: ' (11) 98888-7777 ' }])).toBe(
      '(11) 98888-7777',
    );
    expect(pickContactPhone([INDICATED])).toBe(INDICATED);
    for (const bad of [null, 'x', [], [{}], [{ numero: '' }]])
      expect(pickContactPhone(bad)).toBeNull();
  });
});

describe('contato do retorno vencido', () => {
  it('devolve o contato, lendo por id + lead + org', async () => {
    const client = setup();
    expect(await target(client)).toEqual({
      contactId: 'c-1',
      name: 'José Lima',
      jobTitle: 'Sócio',
      phone: INDICATED,
    });
    expect(db.reads.find((r) => r.table === 'lead_contacts')?.eq).toEqual({
      id: 'c-1',
      lead_id: 'A',
      org_id: ORG,
    });
    expect(db.reads.find((r) => r.table === 'scheduled_activities')?.eq).toMatchObject({
      org_id: ORG,
      lead_id: 'A',
    });
  });

  it.each([
    ['sem contato', { scheduled_activities: [ret({ contact_id: null })] }],
    [
      'retorno futuro',
      {
        scheduled_activities: [
          ret({ scheduled_at: new Date(NOW.getTime() + 60_000).toISOString() }),
        ],
      },
    ],
    ['retorno concluído', { scheduled_activities: [ret({ status: 'completed' })] }],
    ['contato apagado', { lead_contacts: [] }],
    ['contato de outro lead', { lead_contacts: [contact({ lead_id: 'B' })] }],
    ['contato de outra org', { lead_contacts: [contact({ org_id: 'org-2' })] }],
  ])('%s: o portão disca o principal', async (_name, tables) => {
    const client = setup(tables as Record<string, Row[]>);
    const r = await gate(client);
    expect(r).toMatchObject({ ok: true, phone: MAIN });
    expect(r).not.toHaveProperty('contactId');
  });

  it('erro ao ler o contato não recusa o lead', async () => {
    const client = setup();
    db.failReads.add('lead_contacts');
    expect(await gate(client)).toMatchObject({ ok: true, phone: MAIN });
  });

  it('contato sem telefone válido: principal, sem contactId (o cartão ainda sabe o nome)', async () => {
    const client = setup({ lead_contacts: [contact({ phones: [] })] });
    expect(await target(client)).toMatchObject({ name: 'José Lima', phone: null });
    const r = await gate(client);
    expect(r).toMatchObject({ ok: true, phone: MAIN });
    expect(r).not.toHaveProperty('contactId');
  });

  it('portão disca o contato e devolve o contactId', async () => {
    expect(await gate(setup())).toMatchObject({ ok: true, phone: INDICATED, contactId: 'c-1' });
  });

  it('rediscagem depois da primeira tentativa (retorno já consumido na fila) continua no contato', async () => {
    const client = setup({
      calls: [
        {
          id: 'x',
          org_id: ORG,
          user_id: ME,
          lead_id: 'A',
          created_at: ago(10),
          started_at: ago(10),
          hangup_cause: 'NO_ANSWER',
          metadata: {},
        },
      ],
      scheduled_activities: [ret({ scheduled_at: ago(200) })],
    });
    expect(await target(client)).toMatchObject({ phone: INDICATED });
  });

  it('bloqueio de contato e tentativas valem também para o número do indicado', async () => {
    expect(
      await gate(setup({ contact_holds: [{ org_id: ORG, lead_id: 'A', tipo: 'total' }] })),
    ).toEqual({ ok: false, code: 'held' });
    const three = [200, 150, 100].map((m) => ({
      id: `c${m}`,
      org_id: ORG,
      user_id: ME,
      lead_id: 'A',
      created_at: ago(m),
      started_at: ago(m),
      hangup_cause: 'NO_ANSWER',
      metadata: {},
    }));
    expect(await gate(setup({ calls: three }))).toEqual({ ok: false, code: 'attempts' });
  });
});

describe('indicado atendeu: volta ao principal', () => {
  const SCHEDULED = ago(200);
  const call = (over: Row = {}): Row => ({
    id: `k-${Math.random()}`,
    org_id: ORG,
    user_id: ME,
    lead_id: 'A',
    contact_id: 'c-1',
    created_at: ago(100),
    started_at: ago(100),
    answered_at: null,
    duration_seconds: 0,
    status: 'not_connected',
    sdr_disposition: null,
    hangup_cause: 'X',
    metadata: {},
    ...over,
  });
  const withCalls = (...calls: Row[]) =>
    setup({ scheduled_activities: [ret({ scheduled_at: SCHEDULED })], calls });
  const talked = { answered_at: ago(99), duration_seconds: 120 };

  it.each([
    ['atendida com 50 s ou mais', talked],
    [
      'desfecho de conversa marcado pelo SDR, mesmo curta',
      { sdr_disposition: 'answered_no_progress', answered_at: ago(99), duration_seconds: 15 },
    ],
  ])('%s: principal, sem "Retorno com X"', async (_n, over) => {
    expect(await target(withCalls(call(over)))).toBeNull();
    // Portão no dia seguinte à conversa (no mesmo dia a regra "conversa hoje" já segura o lead).
    const yesterday = { created_at: ago(25 * 60), started_at: ago(25 * 60) };
    const r = await gate(
      setup({
        scheduled_activities: [ret({ scheduled_at: ago(26 * 60) })],
        calls: [call({ ...over, ...yesterday })],
      }),
    );
    expect(r).toMatchObject({ ok: true, phone: MAIN });
    expect(r).not.toHaveProperty('contactId');
  });

  it.each([
    ['não atendida', {}],
    ['caixa postal marcada, mesmo longa', { ...talked, sdr_disposition: 'voicemail' }],
    ['atendimento curto sem desfecho', { answered_at: ago(99), duration_seconds: 20 }],
    ['duração sem atendimento (perna do ramal)', { duration_seconds: 300 }],
    ['webhook ainda não chegou', { status: 'not_connected' }],
    ['conversa com o principal (sem contact_id)', { ...talked, contact_id: null }],
    ['conversa antes do horário do retorno', { ...talked, created_at: ago(300) }],
    ['conversa de outra org', { ...talked, org_id: 'org-2' }],
    ['conversa em outro lead', { ...talked, lead_id: 'B' }],
  ])('%s: segue no indicado', async (_n, over) => {
    expect(await target(withCalls(call(over as Row)))).toMatchObject({
      contactId: 'c-1',
      phone: INDICATED,
    });
  });

  it('novo retorno posterior à conversa volta a ligar para o indicado', async () => {
    const client = setup({
      scheduled_activities: [ret({ scheduled_at: ago(30) })],
      calls: [call(talked)],
    });
    expect(await target(client)).toMatchObject({ phone: INDICATED });
  });

  it('erro ao ler as ligações: principal, sem recusar por causa disso', async () => {
    const client = setup();
    db.failReads.add('calls');
    expect(await target(client)).toBeNull();
  });
});

describe('tarefa específica (Atividades, returnId)', () => {
  const task = (client: never, returnId = 'r-1') => loadCallbackTarget({ orgId: ORG, leadId: 'A', now: NOW, returnId, client });
  const future = new Date(NOW.getTime() + 3_600_000).toISOString();

  it('vale o retorno da tarefa, mesmo aberta antes do horário', async () => {
    const client = setup({ scheduled_activities: [ret({ id: 'r-1', scheduled_at: future })] });
    expect(await task(client)).toMatchObject({ contactId: 'c-1', phone: INDICATED });
    expect(await target(client)).toBeNull(); // a discagem continua esperando vencer
  });

  it('tarefa de outro retorno, concluída ou sem contato: principal', async () => {
    for (const over of [{ id: 'r-2' }, { id: 'r-1', status: 'completed' }, { id: 'r-1', contact_id: null }]) {
      expect(await task(setup({ scheduled_activities: [ret(over)] }))).toBeNull();
    }
  });
});

describe('onError separa falha de motivo normal', () => {
  const run = async (tables: Record<string, Row[]>, fail?: string) => {
    const client = setup(tables);
    if (fail) db.failReads.add(fail);
    const onError = vi.fn();
    await loadCallbackTarget({ orgId: ORG, leadId: 'A', now: NOW, client, onError });
    return onError.mock.calls.length;
  };

  it('falha de leitura chama; sem contato, apagado ou já atendeu não chama', async () => {
    for (const table of ['scheduled_activities', 'calls', 'lead_contacts']) expect(await run({}, table)).toBe(1);
    expect(await run({ scheduled_activities: [ret({ contact_id: null })] })).toBe(0);
    expect(await run({ lead_contacts: [] })).toBe(0);
    expect(
      await run({ calls: [{ org_id: ORG, lead_id: 'A', contact_id: 'c-1', created_at: ago(1), sdr_disposition: 'relevant_conversation' }] }),
    ).toBe(0);
  });
});
