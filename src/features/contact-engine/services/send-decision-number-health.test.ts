import { describe, expect, it } from 'vitest';

import type { ActorIdentity } from '../types';

import type { NumberHealthFacts } from './number-health.service';
import {
  decideSend,
  type AccessFacts,
  type ConversationFacts,
  type InstanceFacts,
  type SendDecisionFacts,
  type SendGatewayRequest,
} from './send-decision.service';

const NOW = new Date('2026-11-12T15:00:00.000Z');
const actor: ActorIdentity = { orgId: 'org-1', userId: 'u1', source: 'app', apiKeyId: null };

const request = (over: Partial<SendGatewayRequest> = {}): SendGatewayRequest => ({
  orgId: 'org-1',
  leadId: 'lead-1',
  enrollmentId: null,
  stepId: null,
  channel: 'whatsapp',
  preferredProvider: 'evolution',
  requestedBy: actor,
  contact: '+55 (16) 99986-7577',
  senderInstanceId: 'inst-A',
  template: null,
  ...over,
});

const access: AccessFacts = {
  holds: { bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false },
  lastConsent: 'opt_in',
  blockedReasons: [],
  owner: null,
};
const conversation: ConversationFacts = {
  lastInboundAt: new Date(NOW.getTime() - 3600_000).toISOString(),
  leadRequestedContact: true,
  leadReplied: true,
};
const instance: InstanceFacts = { id: 'inst-A', connected: true, paused: false };

const health = (over: Partial<NumberHealthFacts> = {}): NumberHealthFacts => ({
  instanceId: 'inst-A',
  connected: true,
  state: 'warming',
  newContactsCap: 10,
  totalCap: 20,
  sentNewToday: 0,
  sentTotalToday: 0,
  windowDate: '2026-11-12',
  ...over,
});

const facts = (over: Partial<SendDecisionFacts> = {}): SendDecisionFacts => ({
  request: request(),
  contactValid: true,
  access,
  conversation,
  instance,
  now: NOW,
  ...over,
});

const reasons = (d: ReturnType<typeof decideSend>) => (d.allowed ? [] : d.reasons);

describe('gateway com number_health_v1', () => {
  it('flag desligada (health indefinido): decisao identica a de antes, mesmo com o numero lotado', () => {
    const d = decideSend(facts());
    expect(d).toMatchObject({ allowed: true, provider: 'evolution', senderInstanceId: 'inst-A' });
  });

  it('flag ligada e numero saudavel dentro dos tetos: libera a mesma instancia', () => {
    expect(decideSend(facts({ health: health() }))).toMatchObject({ allowed: true, senderInstanceId: 'inst-A' });
  });

  it('teto total esgotado (respondentes incluidos) nega e fica em espera', () => {
    const d = decideSend(facts({ health: health({ sentTotalToday: 20 }) }));
    expect(reasons(d)).toEqual(['daily_cap_reached']);
    expect(d).toMatchObject({ allowed: false, retryable: true });
  });

  it('numero pausado ou em revisao nega sem retry e sem alternativa', () => {
    for (const state of ['paused', 'review'] as const) {
      const d = decideSend(facts({ health: health({ state }) }));
      expect(reasons(d)).toEqual(['sender_paused']);
      expect(d).toMatchObject({ retryable: false });
      expect(d).not.toHaveProperty('senderInstanceId');
    }
  });

  it('desconectado nega', () => {
    expect(reasons(decideSend(facts({ health: health({ connected: false }) })))).toContain('sender_paused');
  });

  it('leitura incerta da saude nega (fail-closed)', () => {
    const d = decideSend(facts({ health: null }));
    expect(reasons(d)).toEqual(['sender_health_unknown']);
    expect(d).toMatchObject({ retryable: true });
  });

  it('continuidade nao autorizada continua negando e o motivo nao duplica', () => {
    const d = decideSend(
      facts({ health: health(), conversation: { ...conversation, leadRequestedContact: false } }),
    );
    expect(reasons(d)).toEqual(['evolution_requires_authorized_continuity']);
  });

  it('Cloud API oficial nao e afetada pela saude do numero Evolution', () => {
    const d = decideSend(
      facts({
        request: request({ preferredProvider: 'meta_cloud', senderInstanceId: null, template: { id: 't1', approved: true } }),
        health: health({ state: 'paused', sentTotalToday: 999 }),
        instance: { id: 'conn-1', connected: true, paused: false },
      }),
    );
    expect(d).toMatchObject({ allowed: true, provider: 'meta_cloud' });
  });

  it('e-mail nao e afetado', () => {
    const d = decideSend(
      facts({ request: request({ channel: 'email', preferredProvider: null, contact: 'a@b.com' }), health: health({ state: 'paused' }) }),
    );
    expect(d).toMatchObject({ allowed: true, provider: 'gmail' });
  });
});
