import { describe, expect, it } from 'vitest';

import {
  callTalkSeconds,
  canReceiveCalls,
  dialingBlockReason,
  initialWebphoneState,
  isIntegratedCallHeader,
  reduceWebphone,
  remoteNumberFromUri,
  webphoneIdleNeedsAction,
  webphoneIdleProblem,
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
    const s = run([{ type: 'mic', permission: 'granted' }, { type: 'registered' }, { type: 'disabled' }]);
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

  it('depois de encerrada, a nova entra e evento atrasado da anterior não derruba nem muta', () => {
    const ended = run([incoming, { type: 'call_ended', id: 'c1', at: 2000, cause: 'Terminated' }]);
    const next = reduceWebphone(ended, { ...incoming, id: 'c2', remoteNumber: '11954958486', at: 5000 });
    expect(next.call).toMatchObject({ id: 'c2', phase: 'ringing', remoteNumber: '11954958486', muted: false });
    const lateEnd = reduceWebphone(next, { type: 'call_ended', id: 'c1', at: 8000, cause: 'Terminated' });
    const lateMute = reduceWebphone(lateEnd, { type: 'call_muted', id: 'c1', muted: true });
    const lateClear = reduceWebphone(lateMute, { type: 'call_cleared', id: 'c1' });
    expect(lateClear.call).toMatchObject({ id: 'c2', phase: 'ringing', muted: false });
    expect(lateClear).toBe(lateMute);
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

  it('call_stats guarda o último resumo de áudio da ligação certa e sobrevive ao call_ended', () => {
    const stats = { packetsReceived: 10, packetsLost: 1, lossPercent: 9.1, jitterMs: 8, rttMs: 40, collectedAt: 'now' };
    const ringing = run([incoming]);
    expect(ringing.call?.audioStats).toBeNull();
    expect(reduceWebphone(ringing, { type: 'call_stats', id: 'outra', stats })).toBe(ringing);
    const s = run([{ type: 'call_stats', id: 'c1', stats }, { type: 'call_ended', id: 'c1', at: 9000, cause: 'BYE' }], ringing);
    expect(s.call?.audioStats).toEqual(stats);
    expect(s.call?.phase).toBe('ended');
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

  it('canReceiveCalls exige registro, microfone CONCEDIDO e nenhum conflito', () => {
    expect(canReceiveCalls(run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }]))).toBe(true);
    // Microfone ainda não ativado: o INVITE não seria atendido.
    expect(canReceiveCalls(run([{ type: 'registered' }]))).toBe(false);
    expect(canReceiveCalls(run([{ type: 'registered' }, { type: 'mic', permission: 'denied' }]))).toBe(false);
    expect(canReceiveCalls(run([{ type: 'registered' }, { type: 'mic', permission: 'unavailable' }]))).toBe(false);
    expect(canReceiveCalls(run([{ type: 'connecting' }, { type: 'mic', permission: 'granted' }]))).toBe(false);
    expect(
      canReceiveCalls(run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }, { type: 'session_conflict', conflict: 'other_tab' }])),
    ).toBe(false);
  });
});

describe('dialingBlockReason', () => {
  it('não bloqueia com o webphone desligado (fluxo da extensão) nem registrado e livre', () => {
    expect(dialingBlockReason(initialWebphoneState)).toBeNull();
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }]))).toBeNull();
  });

  it('bloqueia enquanto conecta, sem microfone, com erro, desconectado e em ligação', () => {
    expect(dialingBlockReason(run([{ type: 'connecting' }]))).toMatch(/conectando/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', permission: 'denied' }]))).toMatch(/bloqueou o microfone/);
    expect(dialingBlockReason(run([{ type: 'registration_failed', cause: 'Unauthorized' }]))).toMatch(/Unauthorized/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'disconnected' }]))).toMatch(/perdeu a conexão/);
    const inCall = run([
      { type: 'registered' },
      { type: 'call_new', id: 'c1', remoteNumber: '1', direction: 'incoming', integrated: true, at: 1 },
    ]);
    expect(dialingBlockReason(inCall)).toMatch(/em andamento/);
    const ended = reduceWebphone(inCall, { type: 'call_ended', id: 'c1', at: 50, cause: 'Terminated' });
    // Encerrada, mas o microfone nunca foi ativado nesta aba: continua barrado.
    expect(dialingBlockReason(ended)).toMatch(/Ative o microfone/);
    expect(dialingBlockReason(reduceWebphone(ended, { type: 'mic', permission: 'granted' }))).toBeNull();
  });

  it('com ligação em andamento bloqueia pela ligação mesmo com o microfone concedido', () => {
    const s = run([
      { type: 'registered' },
      { type: 'mic', permission: 'granted' },
      { type: 'call_new', id: 'c1', remoteNumber: '1', direction: 'incoming', integrated: true, at: 1 },
    ]);
    expect(dialingBlockReason(s)).toMatch(/em andamento/);
  });

  it('microfone: unknown pede para ativar, denied orienta liberar, unavailable fala do dispositivo', () => {
    expect(dialingBlockReason(run([{ type: 'registered' }]))).toMatch(/Ative o microfone/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', permission: 'denied' }]))).toMatch(/Libere a permissão/);
    expect(dialingBlockReason(run([{ type: 'registered' }, { type: 'mic', permission: 'unavailable' }]))).toMatch(
      /microfone conectado/,
    );
  });

  it('conflito de sessão bloqueia mesmo com disabled (não cai no fluxo da extensão)', () => {
    const otherTab = run([{ type: 'mic', permission: 'granted' }, { type: 'session_conflict', conflict: 'other_tab' }]);
    expect(otherTab.registration).toBe('disabled');
    expect(dialingBlockReason(otherTab)).toMatch(/em uso em outra aba.*Usar nesta aba/);
    const lost = run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }, { type: 'unregistered' }]);
    expect(dialingBlockReason(lost)).toMatch(/extensão da API4COM.*Reconectar/);
  });
});

describe('reduceWebphone: microfone', () => {
  it('guarda os quatro estados e permite retry depois de negado', () => {
    expect(initialWebphoneState.mic).toBe('unknown');
    expect(run([{ type: 'mic', permission: 'unavailable' }]).mic).toBe('unavailable');
    const denied = run([{ type: 'registered' }, { type: 'mic', permission: 'denied' }]);
    expect(denied.mic).toBe('denied');
    const retried = reduceWebphone(denied, { type: 'mic', permission: 'granted' });
    expect(retried).toMatchObject({ mic: 'granted', registration: 'registered' });
  });

  it('mesmo estado de microfone não gera novo objeto', () => {
    const s = run([{ type: 'mic', permission: 'granted' }]);
    expect(reduceWebphone(s, { type: 'mic', permission: 'granted' })).toBe(s);
  });
});

describe('reduceWebphone: conflito de sessão', () => {
  const ready = run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }]);

  it('unregistered direto de registered é perda para outra instância', () => {
    const s = reduceWebphone(ready, { type: 'unregistered' });
    expect(s).toMatchObject({ registration: 'disconnected', sessionConflict: 'lost_to_other' });
  });

  it('queda de WebSocket (disconnected antes do unregistered) NÃO é perda para outra instância', () => {
    const s = run([{ type: 'disconnected', error: 'ws' }, { type: 'unregistered' }, { type: 'connecting' }], ready);
    expect(s.sessionConflict).toBeNull();
    expect(reduceWebphone(s, { type: 'registered' })).toMatchObject({ registration: 'registered', sessionConflict: null });
  });

  it('registrationFailed depois de registrado: perda se não for causa de rede', () => {
    expect(reduceWebphone(ready, { type: 'registration_failed', cause: 'Rejected' }).sessionConflict).toBe('lost_to_other');
    expect(reduceWebphone(ready, { type: 'registration_failed', cause: 'Connection Error' }).sessionConflict).toBeNull();
    expect(reduceWebphone(ready, { type: 'registration_failed', cause: 'Request Timeout' }).sessionConflict).toBeNull();
    // Falha no primeiro registro (nunca esteve registrado) é erro, não conflito.
    expect(run([{ type: 'registration_failed', cause: 'Unauthorized' }]).sessionConflict).toBeNull();
  });

  it('conflito não some com unregistered/disconnected/connecting; só com registered ou disabled', () => {
    const lost = reduceWebphone(ready, { type: 'unregistered' });
    const later = run([{ type: 'unregistered' }, { type: 'disconnected' }, { type: 'connecting' }], lost);
    expect(later.sessionConflict).toBe('lost_to_other');
    expect(canReceiveCalls(later)).toBe(false);
    expect(reduceWebphone(later, { type: 'registered' }).sessionConflict).toBeNull();

    const otherTab = run([{ type: 'session_conflict', conflict: 'other_tab' }, { type: 'unregistered' }]);
    expect(otherTab.sessionConflict).toBe('other_tab');
    expect(dialingBlockReason(otherTab)).toMatch(/outra aba/);
    expect(reduceWebphone(otherTab, { type: 'disabled' }).sessionConflict).toBeNull();
  });
});

describe('pill parado (webphoneIdleProblem / webphoneIdleNeedsAction)', () => {
  it('aparece com microfone não concedido no webphone ligado, conflito e erro', () => {
    expect(webphoneIdleProblem(run([{ type: 'registered' }]))).toBe(true);
    expect(webphoneIdleProblem(run([{ type: 'connecting' }]))).toBe(true);
    expect(webphoneIdleProblem(run([{ type: 'registered' }, { type: 'mic', permission: 'denied' }]))).toBe(true);
    expect(webphoneIdleProblem(run([{ type: 'registered' }, { type: 'mic', permission: 'unavailable' }]))).toBe(true);
    expect(webphoneIdleProblem(run([{ type: 'session_conflict', conflict: 'other_tab' }]))).toBe(true);
    expect(webphoneIdleProblem(run([{ type: 'registration_failed', cause: 'x' }, { type: 'mic', permission: 'granted' }]))).toBe(true);
    expect(webphoneIdleNeedsAction(run([{ type: 'registration_failed', cause: 'x' }, { type: 'mic', permission: 'granted' }]))).toBe(false);
  });

  it('some com tudo pronto e com o webphone desligado sem conflito', () => {
    expect(webphoneIdleProblem(run([{ type: 'registered' }, { type: 'mic', permission: 'granted' }]))).toBe(false);
    expect(webphoneIdleProblem(initialWebphoneState)).toBe(false);
  });
});
