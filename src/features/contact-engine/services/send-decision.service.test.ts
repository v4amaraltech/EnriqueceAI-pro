import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createServiceRoleClient } from '@/lib/supabase/service';

import type { ActorIdentity, MessageProvider } from '../types';

import {
  decideSend,
  evaluateSend,
  getGatewayMode,
  mergeAccess,
  runSendGatewayShadow,
  type AccessFacts,
  type ConversationFacts,
  type InstanceFacts,
  type SendDecisionFacts,
  type SendGatewayRequest,
} from './send-decision.service';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

const NOW = new Date('2026-11-07T12:00:00.000Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

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
  enrollmentId: null,
  stepId: null,
  channel: 'whatsapp',
  preferredProvider: 'meta_cloud',
  requestedBy: actor(),
  contact: '+55 (16) 99986-7577',
  senderInstanceId: null,
  template: null,
  ...over,
});

const access = (over: Partial<AccessFacts> = {}): AccessFacts => ({
  holds: { bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false },
  lastConsent: null,
  blockedReasons: [],
  owner: null,
  ...over,
});

const conv = (over: Partial<ConversationFacts> = {}): ConversationFacts => ({
  lastInboundAt: null,
  leadRequestedContact: false,
  leadReplied: false,
  ...over,
});

const inst = (over: Partial<InstanceFacts> = {}): InstanceFacts => ({ id: 'inst-1', connected: true, paused: false, ...over });

const facts = (over: Partial<SendDecisionFacts> = {}): SendDecisionFacts => ({
  request: request(),
  contactValid: true,
  access: access(),
  conversation: conv(),
  instance: inst(),
  now: NOW,
  ...over,
});

const reasonsOf = (d: ReturnType<typeof decideSend>) => (d.allowed ? [] : d.reasons);
const APPROVED = { id: 'tpl-1', approved: true };

describe('decideSend: oficial, opt-in, template e janela de 24h', () => {
  it('primeiro contato sem opt-in nega com no_consent', () => {
    const d = decideSend(facts({ request: request({ template: APPROVED }) }));
    expect(reasonsOf(d)).toContain('no_consent');
  });

  it('primeiro contato com opt-in mas sem template aprovado nega', () => {
    const d = decideSend(facts({ access: access({ lastConsent: 'opt_in' }) }));
    expect(reasonsOf(d)).toEqual(['outside_service_window_requires_template']);
    const unapproved = decideSend(
      facts({ access: access({ lastConsent: 'opt_in' }), request: request({ template: { id: 't', approved: false } }) }),
    );
    expect(reasonsOf(unapproved)).toEqual(['outside_service_window_requires_template']);
  });

  it('primeiro contato com opt-in e template aprovado autoriza com template', () => {
    const d = decideSend(facts({ access: access({ lastConsent: 'opt_in' }), request: request({ template: APPROVED }) }));
    expect(d).toMatchObject({
      allowed: true,
      provider: 'meta_cloud',
      requiresTemplate: true,
      templateId: 'tpl-1',
      senderInstanceId: 'inst-1',
    });
  });

  it('dentro de 24h autoriza resposta livre sem template', () => {
    const d = decideSend(facts({ conversation: conv({ lastInboundAt: hoursAgo(23), leadReplied: true }) }));
    expect(d).toMatchObject({ allowed: true, requiresTemplate: false, templateId: null });
  });

  it('fora de 24h exige template', () => {
    const conversation = conv({ lastInboundAt: hoursAgo(25), leadReplied: true });
    expect(reasonsOf(decideSend(facts({ conversation })))).toEqual(['outside_service_window_requires_template']);
    const ok = decideSend(facts({ conversation, request: request({ template: APPROVED }) }));
    expect(ok).toMatchObject({ allowed: true, requiresTemplate: true, templateId: 'tpl-1' });
  });

  it('resposta do lead fora da janela nao exige novo opt-in, mas exige template', () => {
    const d = decideSend(facts({ conversation: conv({ lastInboundAt: hoursAgo(72) }), request: request({ template: APPROVED }) }));
    expect(d.allowed).toBe(true);
  });

  it('data de resposta invalida ou no futuro nega (fail-closed)', () => {
    for (const lastInboundAt of ['lixo', new Date(NOW.getTime() + 3600_000).toISOString()]) {
      const d = decideSend(facts({ conversation: conv({ lastInboundAt }) }));
      expect(reasonsOf(d)).toContain('context_unavailable');
    }
  });

  it('e-mail so exige ausencia de bloqueio e usa gmail sem template', () => {
    const d = decideSend(facts({ request: request({ channel: 'email', preferredProvider: null, contact: 'a@b.com' }), conversation: null, instance: null }));
    expect(d).toMatchObject({ allowed: true, provider: 'gmail', requiresTemplate: false });
  });

  it('canal fora do escopo e telefone invalido negam', () => {
    expect(reasonsOf(decideSend(facts({ request: request({ channel: 'phone' }) })))).toContain('channel_not_allowed');
    expect(reasonsOf(decideSend(facts({ contactValid: false })))).toContain('invalid_phone');
  });
});

describe('decideSend: Evolution', () => {
  const evo = (over: Partial<SendDecisionFacts> = {}) =>
    facts({ request: request({ preferredProvider: 'evolution', senderInstanceId: 'inst-1' }), ...over });

  it('autoriza com pedido do lead, resposta e opt-in, sem template', () => {
    const d = decideSend(
      evo({
        access: access({ lastConsent: 'opt_in' }),
        conversation: conv({ lastInboundAt: hoursAgo(100), leadReplied: true, leadRequestedContact: true }),
      }),
    );
    expect(d).toMatchObject({ allowed: true, provider: 'evolution', requiresTemplate: false, senderInstanceId: 'inst-1' });
  });

  it('nega contato frio, so pedido ou so resposta', () => {
    const opt = access({ lastConsent: 'opt_in' });
    for (const conversation of [
      conv(),
      conv({ leadRequestedContact: true }),
      conv({ leadReplied: true, lastInboundAt: hoursAgo(1) }),
    ]) {
      expect(reasonsOf(decideSend(evo({ access: opt, conversation })))).toEqual([
        'evolution_requires_authorized_continuity',
      ]);
    }
  });

  it('nega continuidade sem opt-in vigente', () => {
    const d = decideSend(
      evo({ conversation: conv({ leadReplied: true, leadRequestedContact: true, lastInboundAt: hoursAgo(1) }) }),
    );
    expect(reasonsOf(d)).toContain('evolution_requires_authorized_continuity');
  });

  it('negacao nunca sugere outro provedor: so motivos', () => {
    const d = decideSend(evo());
    expect(d).not.toHaveProperty('provider');
    expect(d).not.toHaveProperty('senderInstanceId');
  });
});

describe('decideSend: dono, opt-out, holds e instancia', () => {
  const okConv = conv({ lastInboundAt: hoursAgo(1), leadReplied: true });

  it('dono divergente nega; o proprio dono autoriza', () => {
    const owner = { userId: 'u2', version: 4, automationMode: 'automatic' as const };
    const d = decideSend(facts({ conversation: okConv, access: access({ owner }) }));
    expect(reasonsOf(d)).toEqual(['owner_mismatch']);
    const mine = decideSend(
      facts({ conversation: okConv, access: access({ owner: { ...owner, userId: 'u1' } }) }),
    );
    expect(mine).toMatchObject({ allowed: true, ownershipVersion: 4 });
  });

  it('automacao de dono em modo humano nega origem nao humana', () => {
    const owner = { userId: 'u1', version: 1, automationMode: 'human' as const };
    const d = decideSend(
      facts({ conversation: okConv, access: access({ owner }), request: request({ requestedBy: actor({ source: 'cron' }) }) }),
    );
    expect(reasonsOf(d)).toContain('recent_reply_requires_human');
  });

  it('opt-out bloqueia os dois provedores', () => {
    for (const preferredProvider of ['meta_cloud', 'evolution'] as MessageProvider[]) {
      const d = decideSend(
        facts({
          request: request({ preferredProvider, senderInstanceId: 'inst-1' }),
          conversation: conv({ lastInboundAt: hoursAgo(1), leadReplied: true, leadRequestedContact: true }),
          access: access({ lastConsent: 'opt_out' }),
        }),
      );
      expect(reasonsOf(d)).toContain('consent_opted_out');
    }
  });

  it('holds bloqueiam os dois provedores', () => {
    for (const preferredProvider of ['meta_cloud', 'evolution'] as MessageProvider[]) {
      const d = decideSend(
        facts({
          request: request({ preferredProvider }),
          conversation: okConv,
          access: access({ holds: { bloqueado_total: true, bloqueado_prospeccao: true, bloqueado_conversa: true } }),
        }),
      );
      expect(reasonsOf(d)).toContain('hold_total');
      expect(d.allowed).toBe(false);
    }
    const prospect = decideSend(
      facts({ conversation: okConv, access: access({ holds: { bloqueado_total: false, bloqueado_prospeccao: true, bloqueado_conversa: false } }) }),
    );
    expect(reasonsOf(prospect)).toEqual(['hold_prospeccao']);
  });

  it('opt-out simultaneo: leitura final com opt-out prevalece sobre a primeira', () => {
    const before = access({ lastConsent: 'opt_in' });
    const after = access({ lastConsent: 'opt_out' });
    const merged = mergeAccess(before, after);
    expect(merged?.lastConsent).toBe('opt_out');
    expect(mergeAccess(after, before)?.lastConsent).toBe('opt_out');
    expect(reasonsOf(decideSend(facts({ access: merged, conversation: okConv })))).toContain('consent_opted_out');
    expect(mergeAccess(before, null)).toBeNull();
  });

  it('instancia pausada, desconectada ou desconhecida nega', () => {
    expect(reasonsOf(decideSend(facts({ conversation: okConv, instance: inst({ paused: true }) })))).toEqual(['sender_paused']);
    expect(reasonsOf(decideSend(facts({ conversation: okConv, instance: inst({ connected: false }) })))).toEqual(['sender_paused']);
    expect(reasonsOf(decideSend(facts({ conversation: okConv, instance: null })))).toEqual(['sender_health_unknown']);
  });

  it('leituras ausentes negam e so incerteza de leitura e retryable', () => {
    const d = decideSend(facts({ access: null, conversation: null, instance: null }));
    expect(d.allowed).toBe(false);
    expect(reasonsOf(d)).toContain('context_unavailable');
    const holdDenied = decideSend(facts({ access: access({ holds: { bloqueado_total: true, bloqueado_prospeccao: true, bloqueado_conversa: true } }), conversation: okConv }));
    expect(holdDenied).toMatchObject({ allowed: false, retryable: false });
    expect(d).toMatchObject({ retryable: true });
  });

  it('flag de ownership desligada nega com flag_disabled', () => {
    const d = decideSend(facts({ conversation: okConv, access: access({ blockedReasons: ['flag_disabled'] }) }));
    expect(reasonsOf(d)).toContain('flag_disabled');
  });
});

// ---------------------------------------------------------------------------
// Wrapper e flags (banco em memoria)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

interface World {
  flags: Record<string, boolean>;
  flagError: boolean;
  tables: Record<string, Row[]>;
  reads: string[];
  writes: string[];
}

function install(w: World) {
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = [];
    const b: Record<string, unknown> = {};
    const run = () => {
      w.reads.push(table);
      if (table === 'app_flags') {
        if (w.flagError) return { data: null, error: { message: 'boom' } };
        const key = filters.find(([k]) => k === 'key')?.[1] as string;
        return { data: key in w.flags ? [{ enabled: w.flags[key] }] : [], error: null };
      }
      const rows = (w.tables[table] ?? []).filter((r) => filters.every(([k, v]) => r[k] === v));
      return { data: rows, error: null };
    };
    for (const m of ['select', 'order', 'limit']) b[m] = vi.fn(() => b);
    b.eq = vi.fn((k: string, v: unknown) => {
      filters.push([k, v]);
      return b;
    });
    for (const m of ['insert', 'update', 'delete', 'upsert']) {
      b[m] = vi.fn(() => {
        w.writes.push(`${table}.${m}`);
        return b;
      });
    }
    b.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko);
    return b;
  };
  vi.mocked(createServiceRoleClient).mockReturnValue({ from: vi.fn(from), rpc: vi.fn() } as never);
}

const world = (over: Partial<World> = {}): World => ({
  flags: { conversation_ownership_v1: true, send_gateway_shadow: false, send_gateway_enforced: false },
  flagError: false,
  tables: {
    contact_holds: [],
    contact_consent_evidence: [{ org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_in', source: 'opt_in_form' }],
    conversation_ownership: [],
    interactions: [],
    whatsapp_connections: [{ org_id: 'org-1', id: 'conn-1', status: 'connected' }],
    whatsapp_instances: [],
  },
  reads: [],
  writes: [],
  ...over,
});

beforeEach(() => {
  vi.mocked(createServiceRoleClient).mockReset();
  vi.restoreAllMocks();
});

describe('evaluateSend (wrapper)', () => {
  it('carrega contexto e autoriza primeiro contato com opt-in e template, sem escrever nada', async () => {
    const w = world();
    install(w);
    const d = await evaluateSend(request({ template: APPROVED }), NOW);
    expect(d).toMatchObject({ allowed: true, provider: 'meta_cloud', requiresTemplate: true, senderInstanceId: 'conn-1' });
    expect(w.writes).toEqual([]);
  });

  it('erro ao criar cliente de banco nega com context_unavailable', async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('sem env');
    });
    const d = await evaluateSend(request({ template: APPROVED }), NOW);
    expect(d).toMatchObject({ allowed: false, retryable: true });
    expect(reasonsOf(d)).toContain('context_unavailable');
  });

  it('opt-out registrado nega no wrapper', async () => {
    const w = world();
    w.tables.contact_consent_evidence!.push({ org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_out', source: 'x' });
    install(w);
    // o mock nao ordena: simula a leitura do ultimo evento removendo o opt_in
    w.tables.contact_consent_evidence = w.tables.contact_consent_evidence!.filter((r) => r.kind === 'opt_out');
    const d = await evaluateSend(request({ template: APPROVED }), NOW);
    expect(reasonsOf(d)).toContain('consent_opted_out');
  });

  it('Evolution com instancia pausada nega', async () => {
    const w = world();
    w.tables.whatsapp_instances!.push({ org_id: 'org-1', id: 'inst-1', status: 'connected', auto_send_paused_at: NOW.toISOString() });
    w.tables.interactions!.push({ org_id: 'org-1', lead_id: 'lead-1', channel: 'whatsapp', type: 'replied', created_at: hoursAgo(1) });
    w.tables.contact_consent_evidence!.push({ org_id: 'org-1', contact_identity: '5516999867577', channel: 'whatsapp', kind: 'opt_in', source: 'user_requested_contact' });
    install(w);
    const d = await evaluateSend(request({ preferredProvider: 'evolution', senderInstanceId: 'inst-1' }), NOW);
    expect(d.allowed).toBe(false);
    expect(reasonsOf(d)).toEqual(['sender_paused']);
  });
});

describe('flags do gateway', () => {
  const current = { allowed: true };

  it('desligadas: modo off, sem leitura de dados, sem log e sem efeito', async () => {
    const w = world();
    install(w);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await getGatewayMode()).toBe('off');
    const r = await runSendGatewayShadow(request(), current);
    expect(r).toEqual({ mode: 'off', compared: false, diverged: null, gateway: null });
    expect(warn).not.toHaveBeenCalled();
    expect(w.reads.filter((t) => t !== 'app_flags')).toEqual([]);
    expect(w.writes).toEqual([]);
  });

  it('linha de flag ausente vale desligada', async () => {
    install(world({ flags: {} }));
    expect(await getGatewayMode()).toBe('off');
  });

  it('shadow ligada: compara, registra log sem PII e nao escreve', async () => {
    const w = world({ flags: { conversation_ownership_v1: true, send_gateway_shadow: true } });
    install(w);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runSendGatewayShadow(request({ template: APPROVED }), { allowed: true });
    expect(r).toMatchObject({ mode: 'shadow', compared: true, diverged: false });
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: 'send_gateway_shadow', gateway: true, current: true });
    expect(line).not.toMatch(/9998|5516|@|token|secret/i);
    expect(w.writes).toEqual([]);
  });

  it('shadow registra divergencia quando o fluxo atual enviaria e o gateway nega', async () => {
    const w = world({ flags: { conversation_ownership_v1: true, send_gateway_shadow: true } });
    w.tables.contact_consent_evidence = [];
    install(w);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await runSendGatewayShadow(request(), { allowed: true });
    expect(r).toMatchObject({ compared: true, diverged: true });
    expect(r.gateway?.allowed).toBe(false);
  });

  it('shadow nunca lanca mesmo com falha de banco', async () => {
    install(world({ flags: { send_gateway_shadow: true } }));
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('x');
    });
    await expect(runSendGatewayShadow(request(), current)).resolves.toMatchObject({ compared: false });
  });

  it('enforced ligada ou ilegivel vale enforced (fail-closed); shadow nao compara nesse modo', async () => {
    install(world({ flags: { send_gateway_enforced: true, send_gateway_shadow: true } }));
    expect(await getGatewayMode()).toBe('enforced');
    expect(await runSendGatewayShadow(request(), current)).toMatchObject({ mode: 'enforced', compared: false });
    install(world({ flagError: true }));
    expect(await getGatewayMode()).toBe('enforced');
  });
});
