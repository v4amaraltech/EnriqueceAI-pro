import { describe, expect, it, vi } from 'vitest';

import {
  WEBPHONE_CONCLUDE_REQUESTED_EVENT,
  contextMatchesCall,
  initialWebphoneCallContextState,
  onWebphoneConcludeRequested,
  reduceWebphoneCallContext,
  requestWebphoneConclude,
  type WebphoneCallContext,
  type WebphoneCallContextAction,
  type WebphoneCallContextState,
} from './webphone-call-context';

const ctx: WebphoneCallContext = {
  callId: 'call-1',
  providerCallId: 'api4com-1',
  leadId: 'lead-1',
  leadName: 'Padaria Pão Quente',
  phone: '(48) 98866-9122',
  ownerHandlesResult: true,
  startedAt: 1000,
};

function run(actions: WebphoneCallContextAction[], from: WebphoneCallContextState = initialWebphoneCallContextState) {
  return actions.reduce(reduceWebphoneCallContext, from);
}

describe('reduceWebphoneCallContext', () => {
  it('set publica o contexto e zera anotações de outra ligação', () => {
    const s = run([{ type: 'notes', notes: 'rascunho antigo' }, { type: 'set', context: ctx }]);
    expect(s).toEqual({ context: ctx, notes: '', heldNotes: [] });
  });

  it('trocar de ligação guarda a anotação da anterior em vez de apagar', () => {
    const previous = { ...ctx, callId: 'call-a', phone: '1151350071' };
    const next = { ...ctx, callId: 'call-b', phone: '11954958486', leadId: 'lead-b' };
    const s = run([
      { type: 'set', context: previous },
      { type: 'notes', notes: '  pediu retorno  ' },
      { type: 'set', context: next },
    ]);
    expect(s.notes).toBe('');
    expect(s.context?.callId).toBe('call-b');
    expect(s.heldNotes).toEqual([{ callId: 'call-a', leadId: 'lead-1', notes: 'pediu retorno' }]);
    expect(reduceWebphoneCallContext(s, { type: 'ack_held_notes', callId: 'call-a' }).heldNotes).toEqual([]);
  });

  it('anotação em branco não é retida, e limpar a ligação atual não descarta a retida', () => {
    const previous = { ...ctx, callId: 'call-a' };
    const next = { ...ctx, callId: 'call-b' };
    const blank = run([{ type: 'set', context: previous }, { type: 'notes', notes: '   ' }, { type: 'set', context: next }]);
    expect(blank.heldNotes).toEqual([]);
    const held = run([
      { type: 'set', context: previous },
      { type: 'notes', notes: 'nota' },
      { type: 'set', context: next },
      { type: 'clear', callId: 'call-b' },
    ]);
    expect(held.context).toBeNull();
    expect(held.heldNotes).toEqual([{ callId: 'call-a', leadId: 'lead-1', notes: 'nota' }]);
  });

  it('set da MESMA ligação (ex.: dono republica) preserva as anotações', () => {
    const s = run([{ type: 'set', context: ctx }, { type: 'notes', notes: 'falou com o sócio' }, { type: 'set', context: { ...ctx, leadName: 'Outro nome' } }]);
    expect(s.notes).toBe('falou com o sócio');
    expect(s.context?.leadName).toBe('Outro nome');
  });

  it('notes atualiza e devolve o mesmo estado quando nada mudou', () => {
    const s1 = run([{ type: 'set', context: ctx }, { type: 'notes', notes: 'a' }]);
    expect(s1.notes).toBe('a');
    expect(reduceWebphoneCallContext(s1, { type: 'notes', notes: 'a' })).toBe(s1);
  });

  it('release_owner só mexe na ligação certa e só se o dono ainda cuidava', () => {
    const s = run([{ type: 'set', context: ctx }]);
    expect(reduceWebphoneCallContext(s, { type: 'release_owner', callId: 'outra' })).toBe(s);
    const released = reduceWebphoneCallContext(s, { type: 'release_owner', callId: 'call-1' });
    expect(released.context?.ownerHandlesResult).toBe(false);
    expect(reduceWebphoneCallContext(released, { type: 'release_owner', callId: 'call-1' })).toBe(released);
  });

  it('clear com callId diferente não apaga; igual (ou sem callId) volta ao inicial', () => {
    const s = run([{ type: 'set', context: ctx }, { type: 'notes', notes: 'x' }]);
    expect(reduceWebphoneCallContext(s, { type: 'clear', callId: 'outra' })).toBe(s);
    expect(reduceWebphoneCallContext(s, { type: 'clear', callId: 'call-1' })).toEqual(initialWebphoneCallContextState);
    expect(reduceWebphoneCallContext(s, { type: 'clear' })).toEqual(initialWebphoneCallContextState);
  });

  it('clear sem contexto limpa anotações soltas (inbound sem initiateCall)', () => {
    const s = run([{ type: 'notes', notes: 'ligou perguntando preço' }]);
    expect(reduceWebphoneCallContext(s, { type: 'clear' })).toEqual(initialWebphoneCallContextState);
    expect(reduceWebphoneCallContext(initialWebphoneCallContextState, { type: 'clear' })).toBe(initialWebphoneCallContextState);
  });
});

describe('contextMatchesCall', () => {
  it('casa quando o contexto nasceu depois do INVITE ou até 60 s antes', () => {
    expect(contextMatchesCall({ ...ctx, startedAt: 10_000 }, { startedAt: 9_000 })).toBe(true);
    expect(contextMatchesCall({ ...ctx, startedAt: 10_000 }, { startedAt: 60_000 })).toBe(true);
    expect(contextMatchesCall({ ...ctx, startedAt: 10_000 }, { startedAt: 70_001 })).toBe(false);
  });

  it('sem contexto ou sem ligação não casa', () => {
    expect(contextMatchesCall(null, { startedAt: 1 })).toBe(false);
    expect(contextMatchesCall(ctx, null)).toBe(false);
  });
});

describe('pedido de conclusão (painel → discador dono)', () => {
  it('entrega o detail ao assinante e a função devolvida cancela', () => {
    const handler = vi.fn();
    const off = onWebphoneConcludeRequested(handler);
    requestWebphoneConclude({ callId: 'call-1', durationSeconds: 42, notes: 'ok' });
    expect(handler).toHaveBeenCalledWith({ callId: 'call-1', durationSeconds: 42, notes: 'ok' });
    off();
    requestWebphoneConclude({ callId: 'call-1', durationSeconds: 1, notes: '' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('ignora eventos sem callId', () => {
    const handler = vi.fn();
    const off = onWebphoneConcludeRequested(handler);
    window.dispatchEvent(new CustomEvent(WEBPHONE_CONCLUDE_REQUESTED_EVENT, { detail: { nope: true } }));
    expect(handler).not.toHaveBeenCalled();
    off();
  });
});
