import { describe, expect, it } from 'vitest';

import {
  callTalkSeconds,
  canReceiveCalls,
  dialingBlockReason,
  initialWebphoneState,
  isIntegratedCallHeader,
  reduceWebphone,
  remoteNumberFromUri,
  type WebphoneEvent,
  type WebphoneState,
} from './webphone-state';

function run(events: WebphoneEvent[], from: WebphoneState = initialWebphoneState): WebphoneState {
  return events.reduce(reduceWebphone, from);
}

describe('reduceWebphone — registro', () => {
  it('connecting → registered → disconnected', () => {
    expect(run([{ type: 'connecting' }]).registration).toBe('connecting');
    expect(run([{ type: 'connecting' }, { type: 'registered' }]).registration).toBe('registered');
    expect(run([{ type: 'registered' }, { type: 'disconnected', error: 'ws' }])).toMatchObject({
      registration: 'disconnected',
      error: 'ws',
    });
  });

  it('registration_failed vira erro com a causa, e unregistered não apaga o erro', () => {
    const s = run([{ type: 'registration_failed', cause: 'Unauthorized' }, { type: 'unregistered' }]);
    expect(s.registration).toBe('error');
    expect(s.error).toContain('Unauthorized');
  });

  it('disabled volta ao inicial mas lembra a permissão do microfone', () => {
    const s = run([{ type: 'mic', granted: true }, { type: 'registered' }, { type: 'disabled' }]);
    expect(s).toEqual({ ...initialWebphoneState, mic: 'granted' });
  });
});

describe('reduceWebphone — ligação', () => {
  const incoming: WebphoneEvent = {
    type: 'call_new',
    id: 'c1',
    remoteNumber: '48988669122',
    direction: 'incoming',
    integrated: true,
    at: 1000,
  };

  it('call_new cria a ligação tocando; accepted marca atendida; ended encerra', () => {
    const ringing = run([{ type: 'registered' }, incoming]);
    expect(ringing.call).toMatchObject({ id: 'c1', phase: 'ringing', integrated: true, answeredAt: null });

    const talking = reduceWebphone(ringing, { type: 'call_accepted', id: 'c1', at: 2000 });
    expect(talking.call).toMatchObject({ phase: 'in-call', answeredAt: 2000 });

    const ended = reduceWebphone(talking, { type: 'call_ended', id: 'c1', at: 9000, cause: 'Terminated' });
    expect(ended.call).toMatchObject({ phase: 'ended', endedAt: 9000, endCause: 'Terminated' });
    expect(callTalkSeconds(ended.call, 99999)).toBe(7);
  });

  it('segunda ligação enquanto uma está em andamento é ignorada', () => {
    const s = run([incoming, { ...incoming, id: 'c2' }]);
    expect(s.call?.id).toBe('c1');
  });

  it('depois de encerrada e limpa, uma nova ligação entra', () => {
    const s = run([
      incoming,
      { type: 'call_ended', id: 'c1', at: 2000, cause: null },
      { type: 'call_cleared', id: 'c1' },
      { ...incoming, id: 'c2' },
    ]);
    expect(s.call?.id).toBe('c2');
  });

  it('eventos de outra ligação não mexem na atual', () => {
    const s = run([incoming, { type: 'call_accepted', id: 'outra', at: 5 }, { type: 'call_muted', id: 'outra', muted: true }]);
    expect(s.call).toMatchObject({ phase: 'ringing', muted: false });
  });

  it('mute/unmute', () => {
    const s = run([incoming, { type: 'call_muted', id: 'c1', muted: true }]);
    expect(s.call?.muted).toBe(true);
  });

  it('callTalkSeconds é 0 antes de atender e usa o agora durante a conversa', () => {
    const ringing = run([incoming]);
    expect(callTalkSeconds(ringing.call, 50_000)).toBe(0);
    const talking = reduceWebphone(ringing, { type: 'call_accepted', id: 'c1', at: 10_000 });
    expect(callTalkSeconds(talking.call, 25_500)).toBe(15);
  });
});

describe('helpers', () => {
  it('isIntegratedCallHeader aceita só "true" (qualquer caixa)', () => {
    expect(isIntegratedCallHeader('true')).toBe(true);
    expect(isIntegratedCallHeader(' TRUE ')).toBe(true);
    expect(isIntegratedCallHeader('1')).toBe(false);
    expect(isIntegratedCallHeader(undefined)).toBe(false);
  });

  it('remoteNumberFromUri mantém só dígitos', () => {
    expect(remoteNumberFromUri('+5548988669122')).toBe('5548988669122');
    expect(remoteNumberFromUri('anonymous')).toBe('');
  });

  it('canReceiveCalls exige registro e microfone não negado', () => {
    expect(canReceiveCalls(run([{ type: 'registered' }]))).toBe(true);
    expect(canReceiveCalls(run([{ type: 'registered' }, { type: 'mic', granted: false }]))).toBe(false);
    expect(canReceiveCalls(run([{ type: 'connecting' }]))).toBe(false);
  });
});

describe('dialingBlockReason', () => {
  it('não bloqueia com o webphone desligado (fluxo da extensão) nem registrado e livre', () => {
    expect(dialingBlockReason(initialWebphoneState)).toBeNull();
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', granted: true }]))).toBeNull();
  });

  it('bloqueia enquanto conecta, sem microfone, com erro, desconectado e em ligação', () => {
    expect(dialingBlockReason(run([{ type: 'connecting' }]))).toMatch(/conectando/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', granted: false }]))).toMatch(/microfone/);
    expect(dialingBlockReason(run([{ type: 'registration_failed', cause: 'Unauthorized' }]))).toMatch(/Unauthorized/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'disconnected' }]))).toMatch(/perdeu a conexão/);
    const inCall = run([
      { type: 'registered' },
      { type: 'call_new', id: 'c1', remoteNumber: '1', direction: 'incoming', integrated: true, at: 1 },
    ]);
    expect(dialingBlockReason(inCall)).toMatch(/em andamento/);
  });
});
