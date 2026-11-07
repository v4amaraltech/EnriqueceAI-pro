import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ActorIdentity, SendDecision } from '../types';

import { computePayloadHash, dispatchOnce, type DispatchPayload, type PayloadResolver, type ProviderAdapter, type ProviderLookupOutcome, type ProviderSendOutcome, type ProviderSendRequest } from './dispatcher.service';
import { installOutboxWorld, makeWorld, seedOutbox, type Row, type World } from './outbox-fake.testkit';
import { applyProviderEvent, RECONCILE_SETTLE_MS, reconcileOnce } from './reconciliation.service';
import { evaluateSend } from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./send-decision.service', () => ({ evaluateSend: vi.fn() }));

const actor: ActorIdentity = { orgId: 'org-1', userId: 'u1', source: 'cron', apiKeyId: null };
const PAYLOAD: DispatchPayload = { body: 'Ola', requestedBy: actor, senderUserId: 'u1' };
const HASH = computePayloadHash(PAYLOAD);

const allowed = (): SendDecision => ({
  allowed: true,
  provider: 'meta_cloud',
  senderInstanceId: 'conn-1',
  requiresTemplate: false,
  templateId: null,
  ownershipVersion: 1,
  consentEvidenceId: null,
  decidedAt: '2026-11-07T12:00:00.000Z',
});

let w: World;
let lookup: ReturnType<typeof vi.fn<() => Promise<ProviderLookupOutcome>>>;
let send: ReturnType<typeof vi.fn<(req: ProviderSendRequest) => Promise<ProviderSendOutcome>>>;
let adapter: ProviderAdapter;
let resolver: PayloadResolver;
let warn: ReturnType<typeof vi.spyOn>;

const uncertainRow = (over: Row = {}, cmd: Row = {}) =>
  seedOutbox(w, { status: 'uncertain', version: 3, attempts: 1, last_error: 'provider_timeout', ...over }, { payloadHash: HASH, ...cmd });

const reconcile = (over: Partial<Parameters<typeof reconcileOnce>[0]> = {}) =>
  reconcileOnce({ orgId: 'org-1', resolver, adapters: { meta_cloud: adapter }, now: () => new Date(w.now), ...over });

const settle = () => {
  w.now += RECONCILE_SETTLE_MS + 1000;
};

beforeEach(() => {
  vi.resetAllMocks();
  w = makeWorld();
  installOutboxWorld(w);
  vi.mocked(evaluateSend).mockResolvedValue(allowed());
  lookup = vi.fn(async () => ({ kind: 'unknown' }) as ProviderLookupOutcome);
  send = vi.fn(async () => ({ kind: 'accepted', externalId: 'wamid.retry' }) as ProviderSendOutcome);
  adapter = { provider: 'meta_cloud', send, lookup };
  resolver = { resolve: vi.fn(async () => PAYLOAD) };
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => warn.mockRestore());

describe('reconcileOnce', () => {
  it('flag desligada: nao consulta nem altera nada', async () => {
    w.flags.dispatcher_v1 = false;
    const row = uncertainRow();
    settle();
    const res = await reconcile();
    expect(res).toMatchObject({ enabled: false, reason: 'flag_disabled', examined: 0 });
    expect(lookup).not.toHaveBeenCalled();
    expect(w.rpcCalls).toEqual([]);
    expect(row.status).toBe('uncertain');
  });

  it('aguarda a janela de consistencia antes de consultar', async () => {
    uncertainRow();
    const res = await reconcile();
    expect(res.waiting).toBe(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('provedor confirma a aceitacao: uncertain vira sent com o id', async () => {
    const row = uncertainRow();
    lookup.mockResolvedValue({ kind: 'accepted', externalId: 'wamid.found' });
    settle();
    const res = await reconcile();
    expect(res.resolvedSent).toBe(1);
    expect(row).toMatchObject({ status: 'sent', external_id: 'wamid.found' });
    expect(send).not.toHaveBeenCalled();
    expect(w.events.map((e) => e.kind)).toContain('reconciled');
  });

  it('resposta desconhecida do provedor: continua uncertain, sem retry', async () => {
    const row = uncertainRow();
    settle();
    const res = await reconcile();
    expect(res.stillUncertain).toBe(1);
    expect(row.status).toBe('uncertain');
    expect(send).not.toHaveBeenCalled();
    expect(vi.mocked(evaluateSend)).not.toHaveBeenCalled();
  });

  it('erro na consulta ao provedor tambem nao libera retry', async () => {
    const row = uncertainRow();
    lookup.mockRejectedValue(new Error('rede'));
    settle();
    const res = await reconcile();
    expect(res.stillUncertain).toBe(1);
    expect(row.status).toBe('uncertain');
  });

  it('adaptador sem consulta nunca resolve sozinho', async () => {
    const row = uncertainRow();
    settle();
    await reconcile({ adapters: { meta_cloud: { provider: 'meta_cloud', send } } });
    expect(row.status).toBe('uncertain');
  });

  it('retry permitido: provedor confirma nao aceitacao, gateway autoriza e o comando e renovado', async () => {
    const row = uncertainRow({}, { expiresAt: new Date(w.now).toISOString() }); // comando original ja vencido apos a espera
    lookup.mockResolvedValue({ kind: 'not_accepted' });
    settle();
    const res = await reconcile();
    expect(res.retryScheduled).toBe(1);
    expect(row.status).toBe('pending');
    expect((row.command as { expiresAt: string }).expiresAt).toBe(new Date(w.now + 15 * 60_000).toISOString());
    expect((row.command as { provider: string }).provider).toBe('meta_cloud');
    expect(w.events.map((e) => e.kind)).toContain('retry_scheduled');
    expect(send).not.toHaveBeenCalled(); // reconciliar nao envia; quem envia e o dispatcher

    // O dispatcher entao envia uma unica vez, com o mesmo provedor.
    const run = await dispatchOnce({ orgId: 'org-1', leaseOwner: 'w1', resolver, adapters: { meta_cloud: adapter }, now: () => new Date(w.now) });
    expect(run.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(row).toMatchObject({ status: 'sent', external_id: 'wamid.retry' });
  });

  it('nao aceita mas gateway nega agora: cancela, nao reenvia', async () => {
    const row = uncertainRow();
    lookup.mockResolvedValue({ kind: 'not_accepted' });
    vi.mocked(evaluateSend).mockResolvedValue({ allowed: false, reasons: ['hold_total'], retryable: false, decidedAt: '' });
    settle();
    const res = await reconcile();
    expect(res.cancelled).toBe(1);
    expect(row.status).toBe('cancelled');
  });

  it('nao aceita e gateway com contexto indisponivel: continua uncertain', async () => {
    const row = uncertainRow();
    lookup.mockResolvedValue({ kind: 'not_accepted' });
    vi.mocked(evaluateSend).mockResolvedValue({ allowed: false, reasons: ['context_unavailable'], retryable: true, decidedAt: '' });
    settle();
    await reconcile();
    expect(row.status).toBe('uncertain');
  });

  it('gateway que muda de provedor ou numero cancela em vez de trocar', async () => {
    const row = uncertainRow();
    lookup.mockResolvedValue({ kind: 'not_accepted' });
    vi.mocked(evaluateSend).mockResolvedValue({ ...(allowed() as Extract<SendDecision, { allowed: true }>), provider: 'evolution', senderInstanceId: 'inst-1' });
    settle();
    await reconcile();
    expect(row.status).toBe('cancelled');
  });

  it('sem tentativas restantes, nao aceita vira failed', async () => {
    const row = uncertainRow({ attempts: 5 });
    lookup.mockResolvedValue({ kind: 'not_accepted' });
    settle();
    const res = await reconcile();
    expect(res.failed).toBe(1);
    expect(row.status).toBe('failed');
  });

  it('sending com lease vencido tambem e reconciliado', async () => {
    const row = seedOutbox(w, { status: 'sending', version: 3, attempts: 1, lease_owner: 'w9', lease_expires_at: w.now + 1000 }, { payloadHash: HASH });
    lookup.mockResolvedValue({ kind: 'accepted', externalId: 'wamid.s' });
    w.now += RECONCILE_SETTLE_MS + 5000;
    row.updated_at = w.now - RECONCILE_SETTLE_MS - 2000;
    const res = await reconcile();
    expect(res.resolvedSent).toBe(1);
    expect(row.status).toBe('sent');
  });

  it('sending com lease ainda valido nao e tocado', async () => {
    const row = seedOutbox(w, { status: 'sending', version: 3, lease_owner: 'w9', lease_expires_at: w.now + 60_000 }, { payloadHash: HASH });
    settle();
    row.lease_expires_at = w.now + 60_000;
    const res = await reconcile();
    expect(res.examined).toBe(0);
  });

  it('isolamento: outra organizacao nao e reconciliada', async () => {
    const row = uncertainRow({ org_id: 'org-2' });
    lookup.mockResolvedValue({ kind: 'accepted', externalId: 'x' });
    settle();
    const res = await reconcile();
    expect(res.examined).toBe(0);
    expect(row.status).toBe('uncertain');
  });

  it('um segundo passe depois de resolvido nao muda nada (idempotente)', async () => {
    const row = uncertainRow();
    lookup.mockResolvedValue({ kind: 'accepted', externalId: 'wamid.found' });
    settle();
    await reconcile();
    const version = row.version;
    const again = await reconcile();
    expect(again.examined).toBe(0);
    expect(row.version).toBe(version);
  });
});

describe('applyProviderEvent', () => {
  const sentRow = (over: Row = {}) => seedOutbox(w, { status: 'sent', version: 4, external_id: 'wamid.1', ...over }, { payloadHash: HASH });
  const event = (status: 'sent' | 'delivered' | 'read' | 'failed', over: Record<string, unknown> = {}) =>
    applyProviderEvent({ orgId: 'org-1', externalId: 'wamid.1', status, source: 'meta_webhook', ...over });

  it('delivered avanca sent para delivered', async () => {
    const row = sentRow();
    const res = await event('delivered');
    expect(res).toMatchObject({ success: true, data: { outcome: 'applied', status: 'delivered' } });
    expect(row.status).toBe('delivered');
  });

  it('read conta como entregue', async () => {
    const row = sentRow();
    await event('read');
    expect(row.status).toBe('delivered');
  });

  it('callback repetido e idempotente: nenhuma versao nova nem evento novo', async () => {
    const row = sentRow();
    await event('delivered');
    const version = row.version;
    const events = w.events.length;
    const again = await event('delivered');
    expect(again).toMatchObject({ success: true, data: { outcome: 'noop' } });
    expect(row.version).toBe(version);
    expect(w.events).toHaveLength(events);
  });

  it('callback fora de ordem: sent depois de delivered nao regride', async () => {
    const row = sentRow();
    await event('delivered');
    const late = await event('sent');
    expect(late).toMatchObject({ success: true, data: { outcome: 'noop', status: 'delivered' } });
    expect(row.status).toBe('delivered');
  });

  it('falha tardia nao rebaixa uma entrega ja confirmada', async () => {
    const row = sentRow();
    await event('delivered');
    const late = await event('failed', { error: 'late' });
    expect(late).toMatchObject({ success: true, data: { outcome: 'noop' } });
    expect(row.status).toBe('delivered');
  });

  it('failed assincrono do provedor leva sent para failed', async () => {
    const row = sentRow();
    const res = await event('failed', { error: 'undeliverable' });
    expect(res).toMatchObject({ success: true, data: { outcome: 'applied', status: 'failed' } });
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('undeliverable');
  });

  it('delivered chega antes da confirmacao do envio: entrada incerta com id conhecido fecha como delivered', async () => {
    const row = uncertainRow({ external_id: null });
    const res = await event('delivered', { outboxId: row.id });
    expect(res).toMatchObject({ success: true, data: { outcome: 'applied', status: 'delivered' } });
    expect(row).toMatchObject({ status: 'delivered', external_id: 'wamid.1' });
    // O sent atrasado que chega depois e ignorado.
    const late = await event('sent', { outboxId: row.id });
    expect(late).toMatchObject({ success: true, data: { outcome: 'noop' } });
    expect(row.status).toBe('delivered');
  });

  it('id desconhecido: unmatched, sem escrita', async () => {
    const res = await event('delivered');
    expect(res).toMatchObject({ success: true, data: { outcome: 'unmatched' } });
    expect(w.rpcCalls).toEqual([]);
  });

  it('id do provedor diferente do gravado e recusado', async () => {
    const row = sentRow();
    const res = await event('delivered', { externalId: 'wamid.OTHER', outboxId: row.id });
    expect(res).toMatchObject({ success: false, code: 'external_id_mismatch' });
    expect(row.status).toBe('sent');
  });

  it('isolamento: evento de outra organizacao nao casa', async () => {
    const row = sentRow({ org_id: 'org-2' });
    const res = await event('delivered');
    expect(res).toMatchObject({ success: true, data: { outcome: 'unmatched' } });
    expect(row.status).toBe('sent');
  });

  it('conflito de versao: le de novo e aplica', async () => {
    const row = sentRow();
    const original = vi.mocked(createServiceRoleClient)();
    let first = true;
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: original.from,
      rpc: vi.fn(async (fn: string, a: Record<string, unknown>) => {
        if (first) {
          first = false;
          row.version = (row.version as number) + 1; // outro processo mexeu na linha
        }
        return (original.rpc as unknown as (f: string, x: Record<string, unknown>) => Promise<unknown>)(fn, a);
      }),
    } as never);
    const res = await event('delivered');
    expect(res).toMatchObject({ success: true, data: { outcome: 'applied', status: 'delivered' } });
  });

  it('valida a entrada', async () => {
    expect(await event('delivered', { externalId: '  ' })).toMatchObject({ success: false, code: 'invalid_input' });
    expect(await event('delivered', { source: '' })).toMatchObject({ success: false, code: 'invalid_input' });
  });
});
