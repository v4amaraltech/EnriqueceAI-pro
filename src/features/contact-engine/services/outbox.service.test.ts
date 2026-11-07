import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ActorIdentity, SendDecision } from '../types';

import {
  buildIdempotencyKey,
  claimSend,
  confirmSend,
  enqueueSend,
  markUncertainOnTimeout,
} from './outbox.service';
import { evaluateSend, type SendGatewayRequest } from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('./send-decision.service', () => ({ evaluateSend: vi.fn() }));

/**
 * Nao ha servidor Postgres neste ambiente (apenas o cliente psql), entao os
 * testes usam o mesmo padrao do PR05: banco em memoria cujas RPCs reproduzem a
 * semantica das funcoes SQL de 20261107170000_send_outbox.sql (unicidade da chave
 * por organizacao, SKIP LOCKED, lease, CAS por version, revalidacao de supressao).
 * Cada RPC e sincrona dentro do mock, como a serializacao de linha do Postgres.
 * A atomicidade real e do banco e precisa de teste de integracao com Postgres
 * (tests/integration), que fica como pendencia.
 */

type Row = Record<string, unknown>;

interface World {
  now: number;
  flag: boolean;
  leads: Row[];
  holds: Row[];
  consent: Row[];
  outbox: Row[];
  events: Row[];
  rpcCalls: string[];
}

function makeWorld(over: Partial<World> = {}): World {
  return {
    now: Date.parse('2026-11-07T12:00:00Z'),
    flag: true,
    leads: [
      { id: 'lead-1', org_id: 'org-1' },
      { id: 'lead-2', org_id: 'org-1' },
      { id: 'lead-9', org_id: 'org-2' },
    ],
    holds: [],
    consent: [],
    outbox: [],
    events: [],
    rpcCalls: [],
    ...over,
  };
}

function installClient(w: World) {
  const iso = (ms: number) => new Date(ms).toISOString();
  const event = (o: Row, kind: string, detail: Row = {}) =>
    w.events.push({ org_id: o.org_id, outbox_id: o.id, kind, detail });

  const suppression = (o: Row): string | null => {
    const hold = w.holds.find((h) => h.org_id === o.org_id && h.lead_id === o.lead_id);
    if (hold) return `hold_${hold.tipo}`;
    const last = w.consent
      .filter((c) => c.org_id === o.org_id && c.contact_identity === o.contact_identity && c.channel === o.channel)
      .at(-1);
    return last?.kind === 'opt_out' ? 'consent_opted_out' : null;
  };

  const from = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'limit']) b[m] = vi.fn(() => b);
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve(table === 'app_flags' ? { data: [{ enabled: w.flag }], error: null } : { data: [], error: null }).then(ok, ko);
    return b;
  };

  const rpc = vi.fn(async (fn: string, a: Record<string, unknown>) => {
    w.rpcCalls.push(fn);

    if (fn === 'enqueue_send') {
      if (!w.flag) return { data: [{ outcome: 'flag_disabled' }], error: null };
      if (!w.leads.some((l) => l.id === a.p_lead_id && l.org_id === a.p_org_id)) {
        return { data: [{ outcome: 'lead_not_in_org' }], error: null };
      }
      const dup = w.outbox.find((o) => o.org_id === a.p_org_id && o.idempotency_key === a.p_idempotency_key);
      if (dup) return { data: [{ outcome: 'duplicate', outbox_id: dup.id, status: dup.status, version: dup.version }], error: null };
      const row: Row = {
        id: `ob-${w.outbox.length + 1}`,
        org_id: a.p_org_id,
        lead_id: a.p_lead_id,
        channel: a.p_channel,
        contact_identity: a.p_contact_identity,
        idempotency_key: a.p_idempotency_key,
        command: a.p_command,
        provider: a.p_provider,
        status: 'pending',
        lease_owner: null,
        lease_expires_at: null,
        attempts: 0,
        version: 1,
        external_id: null,
        created_at: w.now + w.outbox.length,
      };
      w.outbox.push(row);
      event(row, 'enqueued');
      return { data: [{ outcome: 'enqueued', outbox_id: row.id, status: 'pending', version: 1 }], error: null };
    }

    if (fn === 'claim_send') {
      let uncertain = 0;
      let suppressed = 0;
      for (const o of w.outbox) {
        if (o.org_id === a.p_org_id && o.status === 'sending' && (o.lease_expires_at as number) < w.now) {
          o.status = 'uncertain';
          o.version = (o.version as number) + 1;
          event(o, 'lease_expired');
          event(o, 'uncertain');
          uncertain++;
        }
      }
      const empty = () => ({
        data: [{ outcome: 'empty', suppressed_count: suppressed, uncertain_count: uncertain }],
        error: null,
      });
      for (;;) {
        const cand = w.outbox
          .filter(
            (o) =>
              o.org_id === a.p_org_id &&
              (o.status === 'pending' || (o.status === 'reserved' && (o.lease_expires_at as number) < w.now)),
          )
          .sort((x, y) => (x.created_at as number) - (y.created_at as number))[0];
        if (!cand) return empty();
        const reason = suppression(cand);
        if (reason) {
          cand.status = 'suppressed';
          cand.lease_owner = null;
          cand.lease_expires_at = null;
          cand.version = (cand.version as number) + 1;
          event(cand, 'suppressed', { reason, stage: 'claim' });
          suppressed++;
          continue;
        }
        cand.status = 'reserved';
        cand.lease_owner = a.p_lease_owner;
        cand.lease_expires_at = w.now + (a.p_lease_seconds as number) * 1000;
        cand.attempts = (cand.attempts as number) + 1;
        cand.version = (cand.version as number) + 1;
        event(cand, 'reserved');
        return {
          data: [
            {
              outcome: 'claimed',
              outbox_id: cand.id,
              command: cand.command,
              provider: cand.provider,
              channel: cand.channel,
              lead_id: cand.lead_id,
              version: cand.version,
              attempts: cand.attempts,
              lease_expires_at: iso(cand.lease_expires_at as number),
              suppressed_count: suppressed,
              uncertain_count: uncertain,
            },
          ],
          error: null,
        };
      }
    }

    if (fn === 'confirm_send') {
      const o = w.outbox.find((r) => r.id === a.p_outbox_id && r.org_id === a.p_org_id);
      const out = (outcome: string) => ({
        data: [{ outcome, outbox_id: o?.id ?? null, status: o?.status ?? null, version: o?.version ?? null }],
        error: null,
      });
      if (!o) return out('not_found');
      if (o.version !== a.p_expected_version) return out('version_conflict');
      if (o.lease_owner !== a.p_lease_owner) return out('lease_mismatch');
      const target = a.p_target as string;
      const ok =
        (o.status === 'reserved' && ['sending', 'cancelled', 'failed'].includes(target)) ||
        (o.status === 'sending' && ['sent', 'failed', 'uncertain'].includes(target));
      if (!ok) return out('invalid_transition');
      if (target === 'sending') {
        const reason = suppression(o);
        if (reason) {
          o.status = 'suppressed';
          o.lease_owner = null;
          o.lease_expires_at = null;
          o.version = (o.version as number) + 1;
          event(o, 'suppressed', { reason, stage: 'pre_send' });
          return out('suppressed');
        }
      }
      o.status = target;
      o.version = (o.version as number) + 1;
      if (target === 'sent') o.external_id = a.p_external_id;
      if (target !== 'sending') {
        o.lease_owner = null;
        o.lease_expires_at = null;
      }
      event(o, target);
      return out('confirmed');
    }

    return { data: null, error: { message: 'rpc desconhecida' } };
  });

  vi.mocked(createServiceRoleClient).mockReturnValue({ from: vi.fn(from), rpc } as never);
  return { rpc };
}

const actor = (over: Partial<ActorIdentity> = {}): ActorIdentity => ({
  orgId: 'org-1',
  userId: 'u1',
  source: 'app',
  apiKeyId: null,
  ...over,
});

const request = (over: Partial<SendGatewayRequest> = {}): SendGatewayRequest => ({
  orgId: 'org-1',
  leadId: 'lead-1',
  enrollmentId: 'enr-1',
  stepId: 'step-1',
  channel: 'whatsapp',
  preferredProvider: null,
  requestedBy: actor(),
  contact: '+55 16 99986-7577',
  ...over,
});

const HASH = 'a'.repeat(64);

const allowed = (over: Partial<Extract<SendDecision, { allowed: true }>> = {}): SendDecision => ({
  allowed: true,
  provider: 'meta_cloud',
  senderInstanceId: null,
  requiresTemplate: false,
  templateId: null,
  ownershipVersion: 3,
  consentEvidenceId: null,
  decidedAt: '2026-11-07T12:00:00.000Z',
  ...over,
});

let w: World;

beforeEach(() => {
  vi.resetAllMocks();
  w = makeWorld();
  installClient(w);
  vi.mocked(evaluateSend).mockResolvedValue(allowed());
});

const enqueue = (over: Partial<SendGatewayRequest> = {}, attempt = 1) =>
  enqueueSend({ request: request(over), payloadHash: HASH, attempt });

describe('enqueueSend', () => {
  it('grava comando derivado da decisao do gateway, sem corpo de mensagem', async () => {
    const res = await enqueue();
    expect(res.success).toBe(true);
    expect(w.outbox).toHaveLength(1);
    const row = w.outbox[0]!;
    expect(row.status).toBe('pending');
    expect(row.contact_identity).toBe('5516999867577');
    expect(row.command).toEqual({
      provider: 'meta_cloud',
      senderInstanceId: null,
      requiresTemplate: false,
      templateId: null,
      ownershipVersion: 3,
      payloadHash: HASH,
      decidedAt: '2026-11-07T12:00:00.000Z',
      expiresAt: '2026-11-07T12:15:00.000Z',
    });
    expect(w.events.map((e) => e.kind)).toEqual(['enqueued']);
  });

  it('chave repetida nao duplica e devolve a linha existente', async () => {
    const first = await enqueue();
    const second = await enqueue();
    expect(w.outbox).toHaveLength(1);
    expect(first.success && first.data.outcome).toBe('enqueued');
    expect(second.success && second.data.outcome).toBe('duplicate');
    expect(second.success && second.data.outboxId).toBe(first.success && first.data.outboxId);
    expect(w.events.filter((e) => e.kind === 'enqueued')).toHaveLength(1);
  });

  it('a chave nao depende do provedor: trocar de provedor nao cria segunda acao', async () => {
    await enqueue();
    vi.mocked(evaluateSend).mockResolvedValue(allowed({ provider: 'evolution', senderInstanceId: 'inst-1' }));
    const res = await enqueue();
    expect(w.outbox).toHaveLength(1);
    expect(res.success && res.data.outcome).toBe('duplicate');
    expect(w.outbox[0]!.provider).toBe('meta_cloud');
  });

  it('tentativa comercial diferente gera outra acao', async () => {
    await enqueue({}, 1);
    await enqueue({}, 2);
    expect(w.outbox).toHaveLength(2);
    expect(buildIdempotencyKey({ orgId: 'o', leadId: 'l', channel: 'email', enrollmentId: null, stepId: null, attempt: 1 })).toBe(
      'o:l:email:-:-:1',
    );
  });

  it('recusa quando o gateway nega e nada e gravado', async () => {
    vi.mocked(evaluateSend).mockResolvedValue({
      allowed: false,
      reasons: ['hold_total'],
      retryable: false,
      decidedAt: '2026-11-07T12:00:00.000Z',
    });
    const res = await enqueue();
    expect(res).toMatchObject({ success: false, code: 'gateway_denied' });
    expect(w.outbox).toHaveLength(0);
    expect(w.rpcCalls).toEqual([]);
  });

  it('flag desligada nao escreve nem consulta o gateway', async () => {
    w.flag = false;
    const res = await enqueue();
    expect(res).toMatchObject({ success: false, code: 'flag_disabled' });
    expect(w.rpcCalls).toEqual([]);
    expect(w.outbox).toHaveLength(0);
    expect(evaluateSend).not.toHaveBeenCalled();
  });

  it('a RPC tambem barra com a flag desligada (defesa em profundidade)', async () => {
    const reads = [true, false];
    vi.mocked(createServiceRoleClient).mockReturnValue({
      from: vi.fn(() => {
        const b: Record<string, unknown> = {};
        for (const m of ['select', 'eq', 'limit']) b[m] = vi.fn(() => b);
        b.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [{ enabled: reads.shift() ?? false }], error: null }).then(ok);
        return b;
      }),
      rpc: vi.fn(async () => ({ data: [{ outcome: 'flag_disabled' }], error: null })),
    } as never);
    const res = await enqueue();
    expect(res).toMatchObject({ success: false, code: 'flag_disabled' });
  });

  it('valida entrada: hash, contato, tentativa e organizacao do ator', async () => {
    expect(await enqueueSend({ request: request(), payloadHash: 'xyz' })).toMatchObject({ code: 'invalid_input' });
    expect(await enqueueSend({ request: request(), payloadHash: HASH, attempt: 0 })).toMatchObject({ code: 'invalid_input' });
    expect(await enqueue({ contact: '123' })).toMatchObject({ code: 'invalid_contact' });
    expect(await enqueue({ requestedBy: actor({ orgId: 'org-2' }) })).toMatchObject({ code: 'invalid_input' });
    expect(w.outbox).toHaveLength(0);
  });

  it('isolamento: lead de outra organizacao nao entra na fila', async () => {
    const res = await enqueue({ leadId: 'lead-9' });
    expect(res).toMatchObject({ success: false, code: 'not_found' });
    expect(w.outbox).toHaveLength(0);
  });

  it('isolamento: mesma chave em organizacoes diferentes sao acoes independentes', async () => {
    w.leads.push({ id: 'lead-1', org_id: 'org-2' });
    await enqueue();
    await enqueue({ orgId: 'org-2', requestedBy: actor({ orgId: 'org-2' }) });
    expect(w.outbox).toHaveLength(2);
  });
});

describe('claimSend', () => {
  it('reserva com lease, incrementa tentativa e versao', async () => {
    await enqueue();
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w1', leaseSeconds: 30 });
    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.claimed).toMatchObject({ outboxId: 'ob-1', version: 2, attempts: 1, provider: 'meta_cloud' });
    expect(w.outbox[0]).toMatchObject({ status: 'reserved', lease_owner: 'w1', lease_expires_at: w.now + 30_000 });
  });

  it('dois claims concorrentes nao recebem a mesma entrada', async () => {
    await enqueue();
    const [a, b] = await Promise.all([
      claimSend({ orgId: 'org-1', leaseOwner: 'w1' }),
      claimSend({ orgId: 'org-1', leaseOwner: 'w2' }),
    ]);
    const claimed = [a, b].filter((r) => r.success && r.data.claimed !== null);
    expect(claimed).toHaveLength(1);
    expect(w.outbox[0]!.attempts).toBe(1);
  });

  it('dois claims concorrentes com duas entradas reservam uma para cada', async () => {
    await enqueue({ stepId: 'step-1' });
    await enqueue({ stepId: 'step-2' });
    const [a, b] = await Promise.all([
      claimSend({ orgId: 'org-1', leaseOwner: 'w1' }),
      claimSend({ orgId: 'org-1', leaseOwner: 'w2' }),
    ]);
    const ids = [a, b].map((r) => (r.success ? r.data.claimed?.outboxId : null));
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain(null);
  });

  it('lease vigente nao e reservado de novo', async () => {
    await enqueue();
    await claimSend({ orgId: 'org-1', leaseOwner: 'w1', leaseSeconds: 60 });
    w.now += 30_000;
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w2' });
    expect(res.success && res.data.claimed).toBeNull();
    expect(w.outbox[0]!.lease_owner).toBe('w1');
  });

  it('lease expirado em reserved volta a ser reservavel por outro worker', async () => {
    await enqueue();
    await claimSend({ orgId: 'org-1', leaseOwner: 'w1', leaseSeconds: 60 });
    w.now += 61_000;
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w2' });
    expect(res.success && res.data.claimed).toMatchObject({ attempts: 2, version: 3 });
    expect(w.outbox[0]!.lease_owner).toBe('w2');
  });

  it('lease expirado em sending vira uncertain e nunca e reenviado', async () => {
    await enqueue();
    const c = await claimSend({ orgId: 'org-1', leaseOwner: 'w1', leaseSeconds: 60 });
    const claimed = c.success ? c.data.claimed! : (null as never);
    await confirmSend({ orgId: 'org-1', outboxId: claimed.outboxId, expectedVersion: claimed.version, leaseOwner: 'w1', target: 'sending' });
    w.now += 61_000;
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w2' });
    expect(res.success && res.data).toMatchObject({ claimed: null, uncertain: 1 });
    expect(w.outbox[0]!.status).toBe('uncertain');
    expect(w.events.map((e) => e.kind)).toContain('lease_expired');
  });

  it('supressao por opt-out entre enqueue e reserva marca suppressed e nao reserva', async () => {
    await enqueue();
    w.consent.push({ org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_out' });
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    expect(res.success && res.data).toMatchObject({ claimed: null, suppressed: 1 });
    expect(w.outbox[0]).toMatchObject({ status: 'suppressed', lease_owner: null });
    expect(w.events.at(-1)).toMatchObject({ kind: 'suppressed', detail: { reason: 'consent_opted_out', stage: 'claim' } });
  });

  it('opt-in posterior ao opt-out libera a reserva (vale o ultimo consentimento)', async () => {
    await enqueue();
    w.consent.push(
      { org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_out' },
      { org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_in' },
    );
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    expect(res.success && res.data.claimed).not.toBeNull();
  });

  it('supressao por hold entre enqueue e reserva pula a entrada e reserva a proxima', async () => {
    await enqueue({ leadId: 'lead-1' });
    await enqueue({ leadId: 'lead-2' });
    w.holds.push({ org_id: 'org-1', lead_id: 'lead-1', tipo: 'conversa' });
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    expect(res.success && res.data).toMatchObject({ suppressed: 1 });
    expect(res.success && res.data.claimed?.leadId).toBe('lead-2');
    expect(w.outbox.map((o) => o.status)).toEqual(['suppressed', 'reserved']);
  });

  it('isolamento: claim de uma organizacao nao enxerga entradas de outra', async () => {
    await enqueue();
    const res = await claimSend({ orgId: 'org-2', leaseOwner: 'w1' });
    expect(res.success && res.data.claimed).toBeNull();
    expect(w.outbox[0]!.status).toBe('pending');
  });

  it('flag desligada nao reserva (fail-closed)', async () => {
    await enqueue();
    w.flag = false;
    const calls = w.rpcCalls.length;
    const res = await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    expect(res).toMatchObject({ success: false, code: 'flag_disabled' });
    expect(w.rpcCalls).toHaveLength(calls);
    expect(w.outbox[0]!.status).toBe('pending');
  });

  it('valida lease', async () => {
    expect(await claimSend({ orgId: 'org-1', leaseOwner: ' ' })).toMatchObject({ code: 'invalid_input' });
    expect(await claimSend({ orgId: 'org-1', leaseOwner: 'w', leaseSeconds: 0 })).toMatchObject({ code: 'invalid_input' });
    expect(await claimSend({ orgId: 'org-1', leaseOwner: 'w', leaseSeconds: 99999 })).toMatchObject({ code: 'invalid_input' });
  });
});

describe('confirmSend', () => {
  async function reserved() {
    await enqueue();
    const c = await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    if (!c.success || !c.data.claimed) throw new Error('claim falhou');
    return c.data.claimed;
  }
  const base = (c: { outboxId: string; version: number }) => ({
    orgId: 'org-1',
    outboxId: c.outboxId,
    expectedVersion: c.version,
    leaseOwner: 'w1',
  });

  it('fluxo completo: reserved, sending, sent com external_id', async () => {
    const c = await reserved();
    const s1 = await confirmSend({ ...base(c), target: 'sending' });
    expect(s1.success && s1.data).toMatchObject({ status: 'sending', version: 3 });
    const s2 = await confirmSend({ ...base({ outboxId: c.outboxId, version: 3 }), target: 'sent', externalId: 'wamid.123' });
    expect(s2.success && s2.data).toMatchObject({ status: 'sent', version: 4 });
    expect(w.outbox[0]).toMatchObject({ status: 'sent', external_id: 'wamid.123' });
    expect(w.events.map((e) => e.kind)).toEqual(['enqueued', 'reserved', 'sending', 'sent']);
  });

  it('timeout vira uncertain, sem external_id e sem retry', async () => {
    const c = await reserved();
    await confirmSend({ ...base(c), target: 'sending' });
    const res = await markUncertainOnTimeout(base({ outboxId: c.outboxId, version: 3 }));
    expect(res.success && res.data.status).toBe('uncertain');
    expect(w.outbox[0]).toMatchObject({ status: 'uncertain', external_id: null });
    const again = await claimSend({ orgId: 'org-1', leaseOwner: 'w2' });
    expect(again.success && again.data.claimed).toBeNull();
  });

  it('CAS: versao desatualizada e rejeitada e nada muda', async () => {
    const c = await reserved();
    const res = await confirmSend({ ...base({ outboxId: c.outboxId, version: c.version - 1 }), target: 'sending' });
    expect(res).toMatchObject({ success: false, code: 'version_conflict' });
    expect(w.outbox[0]!.status).toBe('reserved');
  });

  it('confirmacao repetida com a versao antiga nao registra duas vezes', async () => {
    const c = await reserved();
    await confirmSend({ ...base(c), target: 'sending' });
    const replay = await confirmSend({ ...base(c), target: 'sending' });
    expect(replay).toMatchObject({ success: false, code: 'version_conflict' });
    expect(w.events.filter((e) => e.kind === 'sending')).toHaveLength(1);
  });

  it('outro worker nao confirma lease alheio', async () => {
    const c = await reserved();
    const res = await confirmSend({ ...base(c), leaseOwner: 'w2', target: 'sending' });
    expect(res).toMatchObject({ success: false, code: 'lease_mismatch' });
  });

  it('transicao invalida: reserved nao vai direto para sent', async () => {
    const c = await reserved();
    const res = await confirmSend({ ...base(c), target: 'sent', externalId: 'x' });
    expect(res).toMatchObject({ success: false, code: 'invalid_transition' });
  });

  it('sent exige external_id', async () => {
    const c = await reserved();
    const res = await confirmSend({ ...base(c), target: 'sent' });
    expect(res).toMatchObject({ success: false, code: 'invalid_input' });
  });

  it('revalida supressao imediatamente antes do envio', async () => {
    const c = await reserved();
    w.holds.push({ org_id: 'org-1', lead_id: 'lead-1', tipo: 'total' });
    const res = await confirmSend({ ...base(c), target: 'sending' });
    expect(res.success && res.data).toMatchObject({ outcome: 'suppressed', status: 'suppressed' });
    expect(w.events.at(-1)).toMatchObject({ kind: 'suppressed', detail: { stage: 'pre_send' } });
  });

  it('isolamento: organizacao diferente nao confirma a entrada', async () => {
    const c = await reserved();
    const res = await confirmSend({ ...base(c), orgId: 'org-2', target: 'sending' });
    expect(res).toMatchObject({ success: false, code: 'not_found' });
  });

  it('confirmar nao depende da flag: resultado de envio nunca fica sem registro', async () => {
    const c = await reserved();
    await confirmSend({ ...base(c), target: 'sending' });
    w.flag = false;
    const res = await confirmSend({ ...base({ outboxId: c.outboxId, version: 3 }), target: 'sent', externalId: 'wamid.9' });
    expect(res.success).toBe(true);
  });
});

describe('sem despacho', () => {
  it('o servico so usa as RPCs da outbox', async () => {
    await enqueue();
    await claimSend({ orgId: 'org-1', leaseOwner: 'w1' });
    expect(new Set(w.rpcCalls)).toEqual(new Set(['enqueue_send', 'claim_send']));
  });
});
