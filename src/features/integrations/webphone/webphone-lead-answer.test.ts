import { describe, expect, it } from 'vitest';

import { effectiveCallSeconds, hangupReasonLabel, isOutOfAreaCall, leadAnswerFromCallRow, leadAnsweredByServer, leadConnected } from './webphone-lead-answer';

describe('leadAnswerFromCallRow', () => {
  it('answered_at presente → atendida (mesmo com hangup_cause normal)', () => {
    expect(leadAnswerFromCallRow({ answered_at: '2026-10-22T00:40:40Z', hangup_cause: 'NORMAL_CLEARING', duration_seconds: 174 })).toBe('answered');
  });

  it('sem answered_at e com hangup_cause → não atendida', () => {
    expect(leadAnswerFromCallRow({ answered_at: null, hangup_cause: 'NUMBER_CHANGED', duration_seconds: 0 })).toBe('not_answered');
    expect(leadAnswerFromCallRow({ answered_at: null, hangup_cause: 'ORIGINATOR_CANCEL', duration_seconds: 0 })).toBe('not_answered');
  });

  it('linha recém-criada (webhook ainda não chegou) → desconhecido', () => {
    expect(leadAnswerFromCallRow({ answered_at: null, hangup_cause: null, duration_seconds: 0 })).toBe('unknown');
    expect(leadAnswerFromCallRow(null)).toBe('unknown');
  });

  it('duração > 0 sem answered_at (ramal legado sem channel-answer) → atendida', () => {
    expect(leadAnswerFromCallRow({ answered_at: null, hangup_cause: null, duration_seconds: 42 })).toBe('answered');
  });
});

describe('leadConnected / effectiveCallSeconds', () => {
  it('o webhook vence o tempo medido na tela', () => {
    expect(leadConnected('not_answered', true)).toBe(false);
    expect(leadConnected('answered', false)).toBe(true);
  });

  it('sem webhook ainda, usa a reserva', () => {
    expect(leadConnected('unknown', true)).toBe(true);
    expect(leadConnected('unknown', false)).toBe(false);
  });

  it('não atendida registra 0 s; nos demais casos, o medido', () => {
    expect(effectiveCallSeconds('not_answered', 7)).toBe(0);
    expect(effectiveCallSeconds('answered', 174)).toBe(174);
    expect(effectiveCallSeconds('unknown', 5)).toBe(5);
  });
});

describe('hangupReasonLabel', () => {
  it('falha da operadora pede para tentar de novo (caso de 03/11/2026)', () => {
    expect(hangupReasonLabel('NORMAL_TEMPORARY_FAILURE')).toBe('Falha na operadora. Tente de novo em instantes.');
    expect(hangupReasonLabel('NETWORK_OUT_OF_ORDER')).toBe('Falha na operadora. Tente de novo em instantes.');
  });

  it('traduz as causas de número ruim, ocupado e não atendeu', () => {
    expect(hangupReasonLabel('UNALLOCATED_NUMBER')).toBe('Este número não existe.');
    expect(hangupReasonLabel('USER_BUSY')).toBe('Linha ocupada.');
    expect(hangupReasonLabel('NO_ANSWER')).toBe('O lead não atendeu.');
    expect(hangupReasonLabel('VOICEMAIL')).toBe('Caiu na caixa postal.');
  });

  it('NUMBER_CHANGED e SUBSCRIBER_ABSENT aparecem como Fora de área (13/11), e ALLOTTED_TIMEOUT é tempo expirado', () => {
    expect(hangupReasonLabel('NUMBER_CHANGED')).toBe('Fora de área.');
    expect(hangupReasonLabel('SUBSCRIBER_ABSENT')).toBe('Fora de área.');
    expect(hangupReasonLabel('ALLOTTED_TIMEOUT')).toBe('Tempo expirado.');
    expect(hangupReasonLabel('ALLOTTED_TIMEOUT')).not.toBe('A operadora não completou a ligação.');
  });

  it('aceita minúsculas/espaços e cai num texto genérico para causa desconhecida', () => {
    expect(hangupReasonLabel(' user_busy ')).toBe('Linha ocupada.');
    expect(hangupReasonLabel('FAILED')).toBe('A operadora não completou a ligação.');
  });

  it('sem causa (webhook ainda não chegou) → null', () => {
    expect(hangupReasonLabel(null)).toBeNull();
    expect(hangupReasonLabel(undefined)).toBeNull();
    expect(hangupReasonLabel('  ')).toBeNull();
  });
});

describe('leadAnsweredByServer', () => {
  it('só o answered_at do webhook vale: locução da operadora na perna do ramal não é Atendida', () => {
    expect(leadAnsweredByServer('answered')).toBe(true);
    expect(leadAnsweredByServer('unknown')).toBe(false);
    expect(leadAnsweredByServer('not_answered')).toBe(false);
  });
});

describe('isOutOfAreaCall', () => {
  it('NUMBER_CHANGED, SUBSCRIBER_ABSENT e a locução de fora de área ou indisponível', () => {
    expect(isOutOfAreaCall({ hangupCause: 'NUMBER_CHANGED' })).toBe(true);
    expect(isOutOfAreaCall({ hangupCause: 'subscriber_absent' })).toBe(true);
    expect(isOutOfAreaCall({ transcript: 'o número está fora de área ou indisponível' })).toBe(true);
    expect(isOutOfAreaCall({ transcript: 'olá o número que você está fora de serviço ou indispon' })).toBe(true);
    expect(isOutOfAreaCall({ transcript: 'número fora do ar ou indisponível' })).toBe(true);
  });

  it('número inexistente segue Falha técnica e caixa postal não é fora de área', () => {
    expect(isOutOfAreaCall({ hangupCause: 'UNALLOCATED_NUMBER' })).toBe(false);
    expect(isOutOfAreaCall({ hangupCause: 'NORMAL_CLEARING' })).toBe(false);
    expect(isOutOfAreaCall({ transcript: 'sua chamada foi encaminhada para o correio de voz' })).toBe(false);
    expect(isOutOfAreaCall({})).toBe(false);
  });
});
