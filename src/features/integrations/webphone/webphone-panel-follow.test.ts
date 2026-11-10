import { describe, expect, it } from 'vitest';

import { contextBelongsToFinished, shouldFollowNewContext, type FinishedCallIdentity } from './webphone-panel-follow';
import type { WebphoneCallContext } from './webphone-call-context';

function ctx(partial: Partial<WebphoneCallContext> & Pick<WebphoneCallContext, 'callId' | 'startedAt'>): WebphoneCallContext {
  return {
    providerCallId: 'prov',
    leadId: 'lead-a',
    leadName: 'Lead A',
    phone: '1151350071',
    ownerHandlesResult: false,
    dialToken: null,
    ...partial,
  };
}

const finishedA: FinishedCallIdentity = {
  startedAt: 1_000_000,
  endedAt: 1_008_000,
  dialToken: 'token-a',
  context: { callId: 'call-a' },
};

describe('contextBelongsToFinished', () => {
  it('o mesmo callId é a ligação encerrada, mesmo minutos depois', () => {
    expect(contextBelongsToFinished(ctx({ callId: 'call-a', startedAt: finishedA.endedAt + 120_000 }), finishedA)).toBe(true);
  });

  it('outro callId é outra ligação, mesmo 1s depois', () => {
    expect(contextBelongsToFinished(ctx({ callId: 'call-b', dialToken: 'token-b', startedAt: finishedA.endedAt + 1_000 }), finishedA)).toBe(false);
  });

  it('sem callId no snapshot, o HTTP da mesma discagem ainda é esta ligação', () => {
    const bare: FinishedCallIdentity = { ...finishedA, context: null };
    expect(contextBelongsToFinished(ctx({ callId: 'call-a', dialToken: 'token-a', startedAt: finishedA.endedAt + 5_000 }), bare)).toBe(true);
  });

  it.each([1_000, 30_000, 59_000])('sem callId, outro token %sms depois não é esta ligação', (delta) => {
    const bare: FinishedCallIdentity = { ...finishedA, context: null };
    for (const same of [true, false]) {
      expect(
        contextBelongsToFinished(
          ctx({
            callId: 'call-b',
            dialToken: 'token-b',
            leadId: same ? 'lead-a' : 'lead-b',
            phone: same ? '1151350071' : '11954958486',
            startedAt: finishedA.endedAt + delta,
          }),
          bare,
        ),
      ).toBe(false);
    }
  });

  it('sem token e sem callId no snapshot, contexto tardio não gruda', () => {
    const bare: FinishedCallIdentity = { ...finishedA, context: null, dialToken: null };
    expect(contextBelongsToFinished(ctx({ callId: 'call-a', startedAt: finishedA.endedAt + 5_000 }), bare)).toBe(false);
  });
});

describe('shouldFollowNewContext', () => {
  it('sem sessão ao vivo, contexto de outra discagem substitui a finalizada', () => {
    const next = ctx({ callId: 'call-b', dialToken: 'token-b', phone: '11954958486', startedAt: finishedA.endedAt + 1_000 });
    expect(shouldFollowNewContext(next, { kind: 'finished', call: finishedA }, null)).toBe(true);
  });

  it('o contexto da própria finalizada não troca a tela', () => {
    const same = ctx({ callId: 'call-a', dialToken: 'token-a', startedAt: finishedA.startedAt + 1_000 });
    expect(shouldFollowNewContext(same, { kind: 'finished', call: finishedA }, null)).toBe(false);
    const bare: FinishedCallIdentity = { ...finishedA, context: null };
    expect(shouldFollowNewContext(same, { kind: 'finished', call: bare }, null)).toBe(false);
  });

  it('sessão SIP em curso continua na tela', () => {
    const next = ctx({ callId: 'call-b', dialToken: 'token-b', startedAt: finishedA.endedAt + 1_000 });
    expect(shouldFollowNewContext(next, { kind: 'finished', call: finishedA }, { startedAt: next.startedAt })).toBe(false);
  });

  it('sem ligação anterior, o contexto publicado já ocupa a tela enquanto o SIP não chega', () => {
    const next = ctx({ callId: 'call-b', dialToken: 'token-b', startedAt: 5_000 });
    expect(shouldFollowNewContext(next, { kind: 'idle', doneContextId: null }, null)).toBe(true);
    expect(shouldFollowNewContext(null, { kind: 'idle', doneContextId: null }, null)).toBe(false);
    expect(shouldFollowNewContext(next, { kind: 'idle', doneContextId: next.callId }, null)).toBe(false);
  });
});
