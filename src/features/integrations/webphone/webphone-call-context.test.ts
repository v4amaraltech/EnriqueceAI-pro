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
  dialToken: null,
};

function run(actions: WebphoneCallContextAction[], from: WebphoneCallContextState = initialWebphoneCallContextState) {
  return actions.reduce(reduceWebphoneCallContext, from);
}

describe('reduceWebphoneCallContext', () => {
  it('set sem âncora guarda a anotação solta em vez de apagar', () => {
    const s = run([
      { type: 'notes', notes: 'rascunho antigo' },
      { type: 'set', context: ctx, holdId: 'h1' },
    ]);
    expect(s.notes).toBe('');
    expect(s.context).toEqual(ctx);
    expect(s.heldNotes).toEqual([
      expect.objectContaining({ holdId: 'h1', callId: null, dialToken: null, notes: 'rascunho antigo' }),
    ]);
  });

  it('trocar de ligação guarda a anotação da anterior em vez de apagar', () => {
    const previous = { ...ctx, callId: 'call-a', phone: '1151350071', dialToken: 'token-a' };
    const next = { ...ctx, callId: 'call-b', phone: '11954958486', leadId: 'lead-b', dialToken: 'token-b' };
    const s = run([
      { type: 'set', context: previous, holdId: 'h0' },
      { type: 'notes', notes: '  pediu retorno  ', anchor: { callId: 'call-a', leadId: 'lead-1', dialToken: 'token-a', phone: '1151350071', leadName: previous.leadName } },
      { type: 'set', context: next, holdId: 'h1' },
    ]);
    expect(s.notes).toBe('');
    expect(s.context?.callId).toBe('call-b');
    expect(s.heldNotes).toEqual([
      expect.objectContaining({ holdId: 'h1', callId: 'call-a', leadId: 'lead-1', dialToken: 'token-a', notes: 'pediu retorno' }),
    ]);
    const rev = s.heldNotes[0]?.rev ?? 0;
    expect(reduceWebphoneCallContext(s, { type: 'ack_held_notes', holdId: 'h1', rev }).heldNotes).toEqual([]);
    expect(reduceWebphoneCallContext(s, { type: 'ack_held_notes', holdId: 'h1', rev: rev - 1 }).heldNotes).toHaveLength(1);
  });

  it('anotação em branco não é retida, e limpar a ligação atual não descarta a retida', () => {
    const previous = { ...ctx, callId: 'call-a', dialToken: 'token-a' };
    const next = { ...ctx, callId: 'call-b', dialToken: 'token-b' };
    const blank = run([
      { type: 'set', context: previous, holdId: 'h0' },
      { type: 'notes', notes: '   ' },
      { type: 'set', context: next, holdId: 'h1' },
    ]);
    expect(blank.heldNotes).toEqual([]);
    const held = run([
      { type: 'set', context: previous, holdId: 'h0' },
      { type: 'notes', notes: 'nota', anchor: { callId: 'call-a', leadId: 'lead-1', dialToken: 'token-a', phone: previous.phone, leadName: previous.leadName } },
      { type: 'set', context: next, holdId: 'h1' },
      { type: 'clear', callId: 'call-b' },
    ]);
    expect(held.context).toBeNull();
    expect(held.heldNotes).toEqual([expect.objectContaining({ callId: 'call-a', leadId: 'lead-1', notes: 'nota' })]);
  });

  it('editar a nota retida aumenta a revisão e uma resposta velha não apaga o texto novo', () => {
    const previous = { ...ctx, callId: 'call-a', dialToken: 'token-a' };
    const next = { ...ctx, callId: 'call-b', dialToken: 'token-b' };
    const held = run([
      { type: 'set', context: previous, holdId: 'h0' },
      { type: 'notes', notes: 'nota antiga', anchor: { callId: 'call-a', leadId: 'lead-1', dialToken: 'token-a', phone: null, leadName: null } },
      { type: 'set', context: next, holdId: 'h1' },
    ]);
    const rev = held.heldNotes[0]?.rev ?? 0;
    const edited = reduceWebphoneCallContext(held, { type: 'edit_held', holdId: 'h1', notes: 'nota nova' });
    expect(edited.heldNotes[0]?.notes).toBe('nota nova');
    expect(edited.heldNotes[0]?.rev).toBe(rev + 1);
    expect(reduceWebphoneCallContext(edited, { type: 'held_result', holdId: 'h1', rev, ok: true }).heldNotes[0]?.notes).toBe('nota nova');
  });

  it('set da MESMA ligação (ex.: dono republica) preserva as anotações', () => {
    const s = run([
      { type: 'set', context: ctx, holdId: 'h0' },
      { type: 'notes', notes: 'falou com o sócio' },
      { type: 'set', context: { ...ctx, leadName: 'Outro nome' }, holdId: 'h1' },
    ]);
    expect(s.notes).toBe('falou com o sócio');
    expect(s.context?.leadName).toBe('Outro nome');
  });

  it('notes atualiza e devolve o mesmo estado quando nada mudou', () => {
    const s1 = run([{ type: 'set', context: ctx, holdId: 'h0' }, { type: 'notes', notes: 'a' }]);
    expect(s1.notes).toBe('a');
    expect(reduceWebphoneCallContext(s1, { type: 'notes', notes: 'a' })).toBe(s1);
  });

  it('release_owner só mexe na ligação certa e só se o dono ainda cuidava', () => {
    const s = run([{ type: 'set', context: ctx, holdId: 'h0' }]);
    expect(reduceWebphoneCallContext(s, { type: 'release_owner', callId: 'outra' })).toBe(s);
    const released = reduceWebphoneCallContext(s, { type: 'release_owner', callId: 'call-1' });
    expect(released.context?.ownerHandlesResult).toBe(false);
    expect(reduceWebphoneCallContext(released, { type: 'release_owner', callId: 'call-1' })).toBe(released);
  });

  it('clear com callId diferente não apaga; igual (ou sem callId) volta ao inicial', () => {
    const s = run([{ type: 'set', context: ctx, holdId: 'h0' }, { type: 'notes', notes: 'x' }]);
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
