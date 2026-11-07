import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActorIdentity, SendDecision } from '../types';

import {
  computePayloadHash,
  dispatchOnce,
  type DispatchPayload,
  type ProviderAdapter,
  type ProviderSendOutcome,
  type ProviderSendRequest,
} from './dispatcher.service';
import { checkDispatchHealth, recordNumberHealthSignals } from './number-health.service';
import { installOutboxWorld, makeWorld, seedOutbox, type World } from './outbox-fake.testkit';
import { evaluateSend } from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./send-decision.service', () => ({ evaluateSend: vi.fn() }));
vi.mock('./number-health.service', () => ({
  checkDispatchHealth: vi.fn(),
  recordNumberHealthSignals: vi.fn(),
}));

const actor: ActorIdentity = { orgId: 'org-1', userId: 'u1', source: 'cron', apiKeyId: null };
const PAYLOAD: DispatchPayload = { body: 'Oi, voltando ao assunto que combinamos', requestedBy: actor, senderUserId: 'u1' };
const HASH = computePayloadHash(PAYLOAD);

const allowedEvolution: SendDecision = {
  allowed: true,
  provider: 'evolution',
  senderInstanceId: 'inst-A',
  requiresTemplate: false,
  templateId: null,
  ownershipVersion: 1,
  consentEvidenceId: null,
  decidedAt: '2026-11-07T12:00:00.000Z',
};

let w: World;
let sendSpy: ReturnType<typeof vi.fn<(req: ProviderSendRequest) => Promise<ProviderSendOutcome>>>;
let adapter: ProviderAdapter;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const run = () =>
  dispatchOnce({
    orgId: 'org-1',
    leaseOwner: 'w1',
    resolver: { resolve: vi.fn(async () => PAYLOAD) },
    adapters: { evolution: adapter, meta_cloud: adapter },
    now: () => new Date(w.now),
  });

const seedEvolution = () =>
  seedOutbox(w, { provider: 'evolution' }, { provider: 'evolution', senderInstanceId: 'inst-A', payloadHash: HASH });

const okHealth = (isNewContact: boolean) =>
  ({ enabled: true, allowed: true, instanceId: 'inst-A', windowDate: '2026-11-07', isNewContact }) as const;

beforeEach(() => {
  vi.resetAllMocks();
  w = makeWorld();
  installOutboxWorld(w);
  vi.mocked(evaluateSend).mockResolvedValue(allowedEvolution);
  vi.mocked(checkDispatchHealth).mockResolvedValue({ enabled: false });
  vi.mocked(recordNumberHealthSignals).mockResolvedValue({ success: true, data: { recorded: true } });
  sendSpy = vi.fn(async () => ({ kind: 'accepted', externalId: 'evo.1' }) as ProviderSendOutcome);
  adapter = { provider: 'evolution', send: sendSpy };
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('dispatcher com number_health_v1', () => {
  it('flag desligada: envia como antes e nao registra nada', async () => {
    const row = seedEvolution();
    const res = await run();
    expect(res.sent).toBe(1);
    expect(row.status).toBe('sent');
    expect(recordNumberHealthSignals).not.toHaveBeenCalled();
  });

  it('provedor oficial nunca consulta a saude do numero', async () => {
    vi.mocked(evaluateSend).mockResolvedValue({ ...allowedEvolution, provider: 'meta_cloud', senderInstanceId: 'conn-1' });
    seedOutbox(w, {}, { payloadHash: HASH });
    const res = await run();
    expect(res.sent).toBe(1);
    expect(checkDispatchHealth).not.toHaveBeenCalled();
    expect(recordNumberHealthSignals).not.toHaveBeenCalled();
  });

  it('consulta a instancia do comando autorizado, com continuidade confirmada pelo gateway', async () => {
    seedEvolution();
    await run();
    expect(checkDispatchHealth).toHaveBeenCalledTimes(1);
    expect(vi.mocked(checkDispatchHealth).mock.calls[0]![0]).toMatchObject({
      orgId: 'org-1',
      senderInstanceId: 'inst-A',
      continuityConfirmedByGateway: true,
    });
  });

  it('permitido: envia e soma contato novo na janela do dia', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue(okHealth(true));
    seedEvolution();
    const res = await run();
    expect(res.sent).toBe(1);
    expect(recordNumberHealthSignals).toHaveBeenCalledTimes(1);
    expect(vi.mocked(recordNumberHealthSignals).mock.calls[0]![0]).toMatchObject({
      orgId: 'org-1',
      instanceId: 'inst-A',
      delta: { sentNewContacts: 1, sentToRespondents: 0, failures: 0 },
    });
  });

  it('respondente conta no total e nao como contato novo', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue(okHealth(false));
    seedEvolution();
    await run();
    expect(vi.mocked(recordNumberHealthSignals).mock.calls[0]![0].delta).toMatchObject({
      sentNewContacts: 0,
      sentToRespondents: 1,
    });
  });

  it('teto esgotado: adia, nao envia, nao cancela e nao procura outro numero', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue({
      enabled: true,
      allowed: false,
      reasons: ['daily_cap_reached'],
      retryable: true,
    });
    const row = seedEvolution();
    const res = await run();
    expect(res).toMatchObject({ claimed: 1, deferred: 1, sent: 0, cancelled: 0 });
    expect(sendSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('reserved');
    expect(checkDispatchHealth).toHaveBeenCalledTimes(1);
    expect(evaluateSend).toHaveBeenCalledTimes(1);
    expect((row.command as { senderInstanceId: string }).senderInstanceId).toBe('inst-A');
    expect(recordNumberHealthSignals).not.toHaveBeenCalled();
  });

  it('numero pausado ou em revisao: cancela com motivo, sem enviar e sem trocar de numero', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue({
      enabled: true,
      allowed: false,
      reasons: ['sender_paused'],
      retryable: false,
    });
    const row = seedEvolution();
    const res = await run();
    expect(res.cancelled).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('cancelled');
    const last = w.events.filter((e) => e.outbox_id === row.id).at(-1);
    expect(last?.detail).toMatchObject({ error: 'number_health:sender_paused' });
    expect((row.command as { senderInstanceId: string }).senderInstanceId).toBe('inst-A');
    // Nenhuma segunda decisao do gateway com outra instancia.
    for (const call of vi.mocked(evaluateSend).mock.calls) {
      expect(call[0].senderInstanceId).toBe('inst-A');
    }
  });

  it('saude incerta (leitura falhou): adia em vez de enviar', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue({
      enabled: true,
      allowed: false,
      reasons: ['sender_health_unknown'],
      retryable: true,
    });
    seedEvolution();
    const res = await run();
    expect(res.deferred).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('resposta ambigua do provedor ainda conta como enviada (conservador)', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue(okHealth(true));
    sendSpy.mockResolvedValue({ kind: 'ambiguous', reason: 'provider_timeout' });
    seedEvolution();
    const res = await run();
    expect(res.uncertain).toBe(1);
    expect(vi.mocked(recordNumberHealthSignals).mock.calls[0]![0].delta).toMatchObject({ sentNewContacts: 1, failures: 0 });
  });

  it('rejeicao garantida registra falha e nao conta como enviada', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue(okHealth(true));
    sendSpy.mockResolvedValue({ kind: 'rejected', reason: 'evolution_not_connected' });
    seedEvolution();
    const res = await run();
    expect(res.failed).toBe(1);
    expect(vi.mocked(recordNumberHealthSignals).mock.calls[0]![0].delta).toMatchObject({
      sentNewContacts: 0,
      sentToRespondents: 0,
      failures: 1,
    });
  });

  it('falha ao registrar telemetria nao derruba o registro do envio', async () => {
    vi.mocked(checkDispatchHealth).mockResolvedValue(okHealth(true));
    vi.mocked(recordNumberHealthSignals).mockRejectedValue(new Error('boom'));
    const row = seedEvolution();
    const res = await run();
    expect(res.sent).toBe(1);
    expect(row.status).toBe('sent');
  });
});
