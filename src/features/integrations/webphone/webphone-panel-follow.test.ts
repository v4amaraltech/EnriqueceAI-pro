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
    ...partial,
  };
}

const finishedA: FinishedCallIdentity = {
  startedAt: 1_000_000,
  endedAt: 1_008_000,
  context: { callId: 'call-a' },
};

describe('contextBelongsToFinished', () => {
  it('o mesmo callId é a ligação encerrada, mesmo minutos depois', () => {
    expect(contextBelongsToFinished(ctx({ callId: 'call-a', startedAt: finishedA.endedAt + 120_000 }), finishedA)).toBe(true);
  });

  it('outro callId é outra ligação', () => {
    expect(contextBelongsToFinished(ctx({ callId: 'call-b', startedAt: finishedA.endedAt + 1_000 }), finishedA)).toBe(false);
  });

  it('sem id no snapshot, o HTTP que chega logo depois ainda é esta ligação', () => {
    const bare: FinishedCallIdentity = { ...finishedA, context: null };
    expect(contextBelongsToFinished(ctx({ callId: 'call-a', startedAt: finishedA.endedAt + 5_000 }), bare)).toBe(true);
  });

  it('sem id no snapshot, um contexto bem posterior é a ligação seguinte', () => {
    const bare: FinishedCallIdentity = { ...finishedA, context: null };
    expect(contextBelongsToFinished(ctx({ callId: 'call-b', startedAt: finishedA.endedAt + 180_000 }), bare)).toBe(false);
  });
});

describe('shouldFollowNewContext', () => {
  it('sem sessão ao vivo, contexto novo substitui a finalizada anterior', () => {
    const next = ctx({ callId: 'call-b', phone: '11954958486', startedAt: finishedA.endedAt + 180_000 });
    expect(shouldFollowNewContext(next, { kind: 'finished', call: finishedA }, null)).toBe(true);
  });

  it('o contexto da própria finalizada não troca a tela', () => {
    const same = ctx({ callId: 'call-a', startedAt: finishedA.startedAt + 1_000 });
    expect(shouldFollowNewContext(same, { kind: 'finished', call: finishedA }, null)).toBe(false);
  });

  it('sessão SIP em curso continua na tela', () => {
    const next = ctx({ callId: 'call-b', startedAt: finishedA.endedAt + 180_000 });
    expect(shouldFollowNewContext(next, { kind: 'finished', call: finishedA }, { startedAt: next.startedAt })).toBe(false);
  });

  it('sem ligação anterior, o contexto publicado já ocupa a tela enquanto o SIP não chega', () => {
    const next = ctx({ callId: 'call-b', startedAt: 5_000 });
    expect(shouldFollowNewContext(next, { kind: 'idle', doneContextId: null }, null)).toBe(true);
    expect(shouldFollowNewContext(null, { kind: 'idle', doneContextId: null }, null)).toBe(false);
    expect(shouldFollowNewContext(next, { kind: 'idle', doneContextId: next.callId }, null)).toBe(false);
  });
});
