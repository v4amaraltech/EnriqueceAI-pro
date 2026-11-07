import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActorIdentity, SendDecision } from '../types';

import {
  computePayloadHash,
  dispatchOnce,
  type DispatchEntry,
  type DispatchPayload,
  type PayloadResolver,
  type ProviderAdapter,
  type ProviderSendOutcome,
  type ProviderSendRequest,
} from './dispatcher.service';
import { installOutboxWorld, makeWorld, seedOutbox, type Row, type World } from './outbox-fake.testkit';
import { evaluateSend } from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./send-decision.service', () => ({ evaluateSend: vi.fn() }));

const actor: ActorIdentity = { orgId: 'org-1', userId: 'u1', source: 'cron', apiKeyId: null };
const PAYLOAD: DispatchPayload = { body: 'Ola, tudo bem?', requestedBy: actor, senderUserId: 'u1' };
const HASH = computePayloadHash(PAYLOAD);

const allowed = (over: Partial<Extract<SendDecision, { allowed: true }>> = {}): SendDecision => ({
  allowed: true,
  provider: 'meta_cloud',
  senderInstanceId: 'conn-1',
  requiresTemplate: false,
  templateId: null,
  ownershipVersion: 1,
  consentEvidenceId: null,
  decidedAt: '2026-11-07T12:00:00.000Z',
  ...over,
});

const denied = (reasons: Extract<SendDecision, { allowed: false }>['reasons'], retryable = false): SendDecision => ({
  allowed: false,
  reasons,
  retryable,
  decidedAt: '2026-11-07T12:00:00.000Z',
});

let w: World;
let sendSpy: ReturnType<typeof vi.fn<(req: ProviderSendRequest) => Promise<ProviderSendOutcome>>>;
let adapter: ProviderAdapter;
let resolver: PayloadResolver;
let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

const run = (over: Partial<Parameters<typeof dispatchOnce>[0]> = {}) =>
  dispatchOnce({
    orgId: 'org-1',
    leaseOwner: 'w1',
    resolver,
    adapters: { meta_cloud: adapter },
    now: () => new Date(w.now),
    ...over,
  });

const reasonOf = (row: Row) => w.events.filter((e) => e.outbox_id === row.id).at(-1)?.detail as { error?: string } | undefined;

const seed = (over = {}, cmd = {}) => seedOutbox(w, over, { payloadHash: HASH, ...cmd });

beforeEach(() => {
  vi.resetAllMocks();
  w = makeWorld();
  installOutboxWorld(w);
  vi.mocked(evaluateSend).mockResolvedValue(allowed());
  sendSpy = vi.fn(async () => ({ kind: 'accepted', externalId: 'wamid.1' }) as ProviderSendOutcome);
  adapter = { provider: 'meta_cloud', send: sendSpy };
  resolver = { resolve: vi.fn(async (_e: DispatchEntry) => PAYLOAD) };
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe('flag dispatcher_v1', () => {
  it('desligada: nao le a fila, nao chama o provedor e nada muda', async () => {
    w.flags.dispatcher_v1 = false;
    const row = seed();
    const res = await run();
    expect(res).toMatchObject({ enabled: false, reason: 'flag_disabled', claimed: 0 });
    expect(w.rpcCalls).toEqual([]);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(evaluateSend).not.toHaveBeenCalled();
    expect(row).toMatchObject({ status: 'pending', version: 1, attempts: 0 });
  });

  it('ausente ou ilegivel conta como desligada (fail-closed para envio)', async () => {
    delete w.flags.dispatcher_v1;
    seed();
    expect((await run()).enabled).toBe(false);
    w.flags.dispatcher_v1 = true;
    w.flagReadError = true;
    expect((await run()).enabled).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(w.rpcCalls).toEqual([]);
  });

  it('desligada no meio da rodada: o item reservado nao e enviado', async () => {
    const row = seed();
    resolver = {
      resolve: vi.fn(async () => {
        w.flags.dispatcher_v1 = false;
        return PAYLOAD;
      }),
    };
    const res = await run();
    expect(res.deferred).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('reserved');
  });
});

describe('envio normal', () => {
  it('claim, revalida, sending, provedor e confirma com o id do provedor', async () => {
    const row = seed();
    const res = await run();
    expect(res).toMatchObject({ enabled: true, claimed: 1, sent: 1 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]![0]).toMatchObject({ orgId: 'org-1', outboxId: row.id, to: '5516999867577' });
    expect(row).toMatchObject({ status: 'sent', external_id: 'wamid.1', lease_owner: null });
    expect(w.events.map((e) => e.kind)).toEqual(['reserved', 'sending', 'sent']);
    // O segundo claim_send encontra a fila vazia e encerra a rodada.
    expect(w.rpcCalls).toEqual(['claim_send', 'confirm_send', 'confirm_send', 'claim_send']);
  });

  it('a revalidacao usa o provedor e a instancia do comando autorizado, sem escolher outro', async () => {
    seed({}, { provider: 'meta_cloud', senderInstanceId: 'conn-1' });
    await run();
    expect(evaluateSend).toHaveBeenCalledTimes(1);
    expect(vi.mocked(evaluateSend).mock.calls[0]![0]).toMatchObject({
      orgId: 'org-1',
      channel: 'whatsapp',
      preferredProvider: 'meta_cloud',
      senderInstanceId: 'conn-1',
      contact: '5516999867577',
    });
  });

  it('processa em ordem ate maxItems', async () => {
    seed();
    seed();
    seed();
    const res = await run({ maxItems: 2 });
    expect(res.sent).toBe(2);
    expect(w.outbox.filter((o) => o.status === 'pending')).toHaveLength(1);
  });

  it('isolamento: nao toca entradas de outra organizacao', async () => {
    const other = seed({ org_id: 'org-2' });
    const res = await run();
    expect(res.claimed).toBe(0);
    expect(other.status).toBe('pending');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('dois dispatchers concorrentes executam a acao uma unica vez', async () => {
    seed();
    const [a, b] = await Promise.all([run({ leaseOwner: 'w1' }), run({ leaseOwner: 'w2' })]);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(a.sent + b.sent).toBe(1);
  });

  it('rodar de novo depois de enviado nao reenvia', async () => {
    seed();
    await run();
    await run();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('incerteza depois do envio', () => {
  it('timeout depois da aceitacao vira uncertain e nunca reenvia', async () => {
    const row = seed();
    // O provedor aceita, mas a resposta chega depois do prazo.
    sendSpy.mockImplementation(
      () => new Promise<ProviderSendOutcome>((resolve) => setTimeout(() => resolve({ kind: 'accepted', externalId: 'wamid.late' }), 80)),
    );
    const res = await run({ providerTimeoutMs: 10 });
    expect(res).toMatchObject({ claimed: 1, uncertain: 1, sent: 0 });
    expect(row).toMatchObject({ status: 'uncertain', last_error: 'provider_timeout', external_id: null });

    await new Promise((r) => setTimeout(r, 120)); // resposta tardia e descartada
    expect(row.status).toBe('uncertain');

    w.now += 3_600_000;
    await run();
    await run();
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(row.status).toBe('uncertain');
  });

  it('excecao do adaptador vira uncertain', async () => {
    const row = seed();
    sendSpy.mockRejectedValue(new Error('socket hang up'));
    const res = await run();
    expect(res.uncertain).toBe(1);
    expect(row).toMatchObject({ status: 'uncertain', last_error: 'provider_exception' });
  });

  it('resposta ambigua vira uncertain com o motivo', async () => {
    const row = seed();
    sendSpy.mockResolvedValue({ kind: 'ambiguous', reason: 'provider_error_unclassified' });
    await run();
    expect(row).toMatchObject({ status: 'uncertain', last_error: 'provider_error_unclassified' });
  });

  it('aceito sem id do provedor nao e sent: fica uncertain', async () => {
    const row = seed();
    sendSpy.mockResolvedValue({ kind: 'accepted', externalId: '   ' });
    await run();
    expect(row.status).toBe('uncertain');
  });

  it('recusa definitiva do servico (nada saiu) vira failed, sem repetir', async () => {
    const row = seed();
    sendSpy.mockResolvedValue({ kind: 'rejected', reason: 'provider_not_sent' });
    const res = await run();
    expect(res.failed).toBe(1);
    expect(row).toMatchObject({ status: 'failed', last_error: 'provider_not_sent' });
    await run();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('envio ocorreu mas a confirmacao falhou: fica sending, vira uncertain pelo lease e nao reenvia', async () => {
    const row = seed();
    sendSpy.mockImplementation(async () => {
      w.confirmFailures = 3; // a escrita do resultado falha nas 3 tentativas
      return { kind: 'accepted', externalId: 'wamid.lost' };
    });
    const res = await run();
    expect(res.confirmFailed).toBe(1);
    expect(row.status).toBe('sending');
    expect(error.mock.calls.flat().join(' ')).toContain('wamid.lost'); // id do provedor para conciliacao

    w.now += 10 * 60_000;
    const next = await run();
    expect(next.uncertainAtClaim).toBe(1);
    expect(row.status).toBe('uncertain');
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe('revalidacao antes de enviar', () => {
  it('pausa do numero: gateway nega e a entrada e cancelada sem chamar o provedor', async () => {
    const row = seed();
    vi.mocked(evaluateSend).mockResolvedValue(denied(['sender_paused']));
    const res = await run();
    expect(res.cancelled).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('gateway_denied:sender_paused');
  });

  it('opt-out gravado depois do claim: confirm_send suprime e o provedor nao e chamado', async () => {
    const row = seed();
    resolver = {
      resolve: vi.fn(async () => {
        w.consent.push({ org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_out' });
        return PAYLOAD;
      }),
    };
    const res = await run();
    expect(res.suppressed).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(row.status).toBe('suppressed');
    expect(w.events.find((e) => e.kind === 'suppressed')?.detail).toMatchObject({ reason: 'consent_opted_out', stage: 'pre_send' });
  });

  it('hold ja existente e suprimido no claim', async () => {
    const row = seed();
    w.holds.push({ org_id: 'org-1', lead_id: 'lead-1', tipo: 'total' });
    const res = await run();
    expect(res).toMatchObject({ claimed: 0, suppressedAtClaim: 1 });
    expect(row.status).toBe('suppressed');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('dono mudou: gateway nega por owner_mismatch e cancela', async () => {
    const row = seed();
    vi.mocked(evaluateSend).mockResolvedValue(denied(['owner_mismatch']));
    await run();
    expect(row.status).toBe('cancelled');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('contexto indisponivel (retryable) adia: nada muda e o lease vence', async () => {
    const row = seed();
    vi.mocked(evaluateSend).mockResolvedValue(denied(['context_unavailable'], true));
    const res = await run();
    expect(res.deferred).toBe(1);
    expect(row.status).toBe('reserved');
    expect(sendSpy).not.toHaveBeenCalled();

    // Depois do lease, volta a ser candidata e envia.
    vi.mocked(evaluateSend).mockResolvedValue(allowed());
    w.now += 5 * 60_000;
    await run();
    expect(row).toMatchObject({ status: 'sent', attempts: 2 });
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it('gateway que passa a apontar outro provedor ou numero cancela: nunca cai para outro caminho', async () => {
    const evo: ProviderAdapter = { provider: 'evolution', send: vi.fn() };
    const row = seed();
    vi.mocked(evaluateSend).mockResolvedValue(allowed({ provider: 'evolution', senderInstanceId: 'inst-9' }));
    await run({ adapters: { meta_cloud: adapter, evolution: evo } });
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('decision_diverged');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(evo.send).not.toHaveBeenCalled();
  });

  it('mesma instancia exigida: troca de numero dentro do mesmo provedor tambem cancela', async () => {
    const row = seed({}, { senderInstanceId: 'conn-1' });
    vi.mocked(evaluateSend).mockResolvedValue(allowed({ senderInstanceId: 'conn-2' }));
    await run();
    expect(row.status).toBe('cancelled');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('adaptador do provedor ausente: cancela, nao usa outro adaptador', async () => {
    const other: ProviderAdapter = { provider: 'gmail', send: vi.fn() };
    const row = seed();
    await run({ adapters: { gmail: other } });
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('adapter_missing');
    expect(other.send).not.toHaveBeenCalled();
  });

  it('comando vencido e rejeitado', async () => {
    const row = seed({}, { expiresAt: new Date(w.now - 1000).toISOString() });
    await run();
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('command_expired');
    expect(sendSpy).not.toHaveBeenCalled();
    expect(evaluateSend).not.toHaveBeenCalled();
  });

  it('hash do payload divergente: falha sem enviar', async () => {
    const row = seed({}, { payloadHash: 'b'.repeat(64) });
    await run();
    expect(row).toMatchObject({ status: 'failed', last_error: 'payload_hash_mismatch' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('conteudo indisponivel: falha sem enviar', async () => {
    const row = seed();
    resolver = { resolve: vi.fn(async () => null) };
    await run();
    expect(row).toMatchObject({ status: 'failed', last_error: 'payload_unavailable' });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('ator de outra organizacao no payload e barrado', async () => {
    const row = seed();
    resolver = { resolve: vi.fn(async () => ({ ...PAYLOAD, requestedBy: { ...actor, orgId: 'org-2' } })) };
    await run();
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('actor_org_mismatch');
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('desiste depois do maximo de tentativas', async () => {
    const row = seed({ attempts: 5 });
    await run();
    expect(row.status).toBe('cancelled');
    expect(reasonOf(row)?.error).toBe('max_attempts');
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('logs', () => {
  it('nao registra telefone, corpo de mensagem nem segredos', async () => {
    seed();
    sendSpy.mockRejectedValue(new Error('Bearer secret-token 5516999867577'));
    await run();
    const logged = [...warn.mock.calls, ...error.mock.calls].flat().join(' ');
    expect(logged).not.toContain('5516999867577');
    expect(logged).not.toContain('Ola, tudo bem');
    expect(logged).not.toContain('secret-token');
  });
});
