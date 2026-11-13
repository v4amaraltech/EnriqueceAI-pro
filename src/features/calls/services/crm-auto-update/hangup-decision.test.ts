import { describe, expect, it } from 'vitest';

import { classifyHangupForCrm, decideHangupCrm, isAnsweredTimestamp } from './hangup-decision';

const ANSWERED = '2026-11-12T13:00:05.000Z';
const RETRY = { type: 'retry', channel: 'phone' };
const NONE = { type: 'none', channel: null };

describe('classifyHangupForCrm', () => {
  it.each([
    ['NUMBER_CHANGED', 'voicemail', 'voicemail', RETRY],
    ['NO_ANSWER', 'no_answer', 'no_answer', RETRY],
    ['NO_USER_RESPONSE', 'no_answer', 'no_answer', RETRY],
    ['ALLOTTED_TIMEOUT', 'no_answer', 'no_answer', RETRY],
    ['USER_BUSY', 'busy', 'no_answer', RETRY],
    ['CALL_REJECTED', 'rejected', 'no_answer', RETRY],
    ['UNALLOCATED_NUMBER', 'invalid_number', 'technical_failure', NONE],
    ['INVALID_NUMBER_FORMAT', 'invalid_number', 'technical_failure', NONE],
    ['NORMAL_TEMPORARY_FAILURE', 'technical_failure', 'technical_failure', RETRY],
    ['RECOVERY_ON_TIMER_EXPIRE', 'technical_failure', 'technical_failure', RETRY],
  ])('%s sem answered_at: outcome %s, disposition %s', (cause, outcome, disposition, next) => {
    expect(classifyHangupForCrm({ hangupCause: cause, answeredAt: null, durationSeconds: 0 })).toEqual({
      outcome,
      hangup_cause: cause,
      confidence: 1,
      proposed: { disposition, next_activity: next, lead_status: null },
    });
  });

  it('NUMBER_CHANGED com e sem answered_at vira caixa postal', () => {
    for (const answeredAt of [null, '', ANSWERED]) {
      const r = classifyHangupForCrm({ hangupCause: 'NUMBER_CHANGED', answeredAt, durationSeconds: 8 });
      expect(r?.outcome).toBe('voicemail');
      expect(r?.proposed.disposition).toBe('voicemail');
    }
  });

  it('UNALLOCATED_NUMBER atendida curta vira número inválido', () => {
    const r = classifyHangupForCrm({ hangupCause: 'UNALLOCATED_NUMBER', answeredAt: ANSWERED, durationSeconds: 4 });
    expect(r?.outcome).toBe('invalid_number');
    expect(r?.proposed).toEqual({ disposition: 'technical_failure', next_activity: NONE, lead_status: null });
  });

  it('causa de não atendeu com answered_at: sinal contraditório, null', () => {
    for (const cause of ['NO_ANSWER', 'USER_BUSY', 'CALL_REJECTED', 'NORMAL_TEMPORARY_FAILURE']) {
      expect(classifyHangupForCrm({ hangupCause: cause, answeredAt: ANSWERED, durationSeconds: 5 })).toBeNull();
    }
  });

  it('ORIGINATOR_CANCEL fica de fora, com e sem answered_at', () => {
    expect(classifyHangupForCrm({ hangupCause: 'ORIGINATOR_CANCEL', answeredAt: null, durationSeconds: 0 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: 'ORIGINATOR_CANCEL', answeredAt: ANSWERED, durationSeconds: 3 })).toBeNull();
  });

  it('NORMAL_CLEARING atendida curta precisa de áudio: null', () => {
    expect(classifyHangupForCrm({ hangupCause: 'NORMAL_CLEARING', answeredAt: ANSWERED, durationSeconds: 12 })).toBeNull();
  });

  it('causa nula ou desconhecida: null', () => {
    expect(classifyHangupForCrm({ hangupCause: null, answeredAt: null, durationSeconds: 0 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: '', answeredAt: null, durationSeconds: 0 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: 'SOMETHING_NEW', answeredAt: null, durationSeconds: 0 })).toBeNull();
  });

  it('atendida com 30 s ou mais é do JEV, mesmo com causa clara', () => {
    for (const cause of ['NUMBER_CHANGED', 'UNALLOCATED_NUMBER', 'INVALID_NUMBER_FORMAT']) {
      expect(classifyHangupForCrm({ hangupCause: cause, answeredAt: ANSWERED, durationSeconds: 30 })).toBeNull();
      expect(classifyHangupForCrm({ hangupCause: cause, answeredAt: ANSWERED, durationSeconds: 95 })).toBeNull();
    }
  });

  it('atendida com 29 s e NUMBER_CHANGED classifica', () => {
    expect(
      classifyHangupForCrm({ hangupCause: 'NUMBER_CHANGED', answeredAt: ANSWERED, durationSeconds: 29 })?.outcome,
    ).toBe('voicemail');
  });

  it('não atendida longa ainda classifica (o JEV não pega)', () => {
    expect(classifyHangupForCrm({ hangupCause: 'NO_ANSWER', answeredAt: null, durationSeconds: 45 })?.outcome).toBe(
      'no_answer',
    );
  });

  it('USER_BUSY: disposition no_answer e outcome busy', () => {
    const r = classifyHangupForCrm({ hangupCause: 'USER_BUSY', answeredAt: null, durationSeconds: 0 });
    expect(r?.outcome).toBe('busy');
    expect(r?.proposed.disposition).toBe('no_answer');
  });

  it('normaliza caixa e espaços da causa', () => {
    expect(classifyHangupForCrm({ hangupCause: ' number_changed ', answeredAt: null, durationSeconds: 0 })?.hangup_cause).toBe(
      'NUMBER_CHANGED',
    );
  });
});

describe('isAnsweredTimestamp', () => {
  it('string vazia, nula ou inválida conta como não atendida', () => {
    expect(isAnsweredTimestamp(null)).toBe(false);
    expect(isAnsweredTimestamp(undefined)).toBe(false);
    expect(isAnsweredTimestamp('  ')).toBe(false);
    expect(isAnsweredTimestamp('não é data')).toBe(false);
    expect(isAnsweredTimestamp('2026-11-12 10:00:05')).toBe(true);
    expect(isAnsweredTimestamp(ANSWERED)).toBe(true);
  });
});

describe('decideHangupCrm', () => {
  const classification = classifyHangupForCrm({ hangupCause: 'NUMBER_CHANGED', answeredAt: null, durationSeconds: 0 })!;
  const call = { lead_id: 'lead-1', sdr_disposition: null, legacy_ai_outcome_applied: false };

  it('lead e sem desfecho: would_apply', () => {
    expect(decideHangupCrm({ classification, call })).toEqual({
      verdict: 'would_apply',
      proposed: classification.proposed,
      skip_reason: null,
    });
  });

  it('SDR já registrou: skip already_dispositioned com proposta', () => {
    expect(decideHangupCrm({ classification, call: { ...call, sdr_disposition: 'no_answer' } })).toEqual({
      verdict: 'skip',
      proposed: classification.proposed,
      skip_reason: 'already_dispositioned',
    });
  });

  it('desfecho do fluxo antigo da IA conta como already_dispositioned', () => {
    const d = decideHangupCrm({ classification, call: { ...call, legacy_ai_outcome_applied: true } });
    expect(d.skip_reason).toBe('already_dispositioned');
    expect(d.proposed).toEqual(classification.proposed);
  });

  it('sem lead: skip no_lead com proposta', () => {
    expect(decideHangupCrm({ classification, call: { ...call, lead_id: null } })).toEqual({
      verdict: 'skip',
      proposed: classification.proposed,
      skip_reason: 'no_lead',
    });
  });
});
