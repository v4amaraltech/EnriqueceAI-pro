import { describe, expect, it } from 'vitest';

import { classifyHangupForCrm, decideHangupCrm, isAnsweredTimestamp, shouldApplyLiveHangupNoAnswer } from './hangup-decision';

const ANSWERED = '2026-11-12T13:00:05.000Z';
const RETRY = { type: 'retry', channel: 'phone' };
const NONE = { type: 'none', channel: null };

describe('classifyHangupForCrm', () => {
  it.each([
    ['NUMBER_CHANGED', 'no_answer', 'no_answer', RETRY],
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

  it('NUMBER_CHANGED com e sem answered_at vira não atendeu', () => {
    for (const answeredAt of [null, '', ANSWERED]) {
      const r = classifyHangupForCrm({ hangupCause: 'NUMBER_CHANGED', answeredAt, durationSeconds: 8 });
      expect(r?.outcome).toBe('no_answer');
      expect(r?.proposed.disposition).toBe('no_answer');
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
    ).toBe('no_answer');
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

describe('shouldApplyLiveHangupNoAnswer', () => {
  const call = { lead_id: 'lead-1', sdr_disposition: null, legacy_ai_outcome_applied: false };
  const classify = (hangupCause: string, answeredAt: string | null = null, durationSeconds = 0) =>
    classifyHangupForCrm({ hangupCause, answeredAt, durationSeconds })!;
  const would = (c = classify('NUMBER_CHANGED')) => decideHangupCrm({ classification: c, call });

  it.each([
    ['NUMBER_CHANGED', null, 0],
    ['NUMBER_CHANGED', ANSWERED, 29],
    ['NO_ANSWER', null, 0],
    ['NO_USER_RESPONSE', null, 0],
    ['ALLOTTED_TIMEOUT', null, 0],
    ['USER_BUSY', null, 5],
    ['CALL_REJECTED', null, 0],
  ] as const)('%s (answered_at=%s, %ss): live + would_apply escreve no_answer', (cause, answeredAt, duration) => {
    const classification = classify(cause, answeredAt, duration);
    const decision = decideHangupCrm({ classification, call });
    expect(decision.verdict).toBe('would_apply');
    expect(decision.proposed.disposition).toBe('no_answer');
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'live', decision, classification })).toBe(true);
  });

  it.each([
    ['UNALLOCATED_NUMBER', null, 0],
    ['INVALID_NUMBER_FORMAT', null, 0],
    ['UNALLOCATED_NUMBER', ANSWERED, 12],
    ['NORMAL_TEMPORARY_FAILURE', null, 0],
    ['RECOVERY_ON_TIMER_EXPIRE', null, 0],
  ] as const)('%s (answered_at=%s): would_apply no shadow, mas live NÃO escreve', (cause, answeredAt, duration) => {
    const classification = classify(cause, answeredAt, duration);
    const decision = decideHangupCrm({ classification, call });
    expect(decision.verdict).toBe('would_apply');
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'live', decision, classification })).toBe(false);
  });

  it('ORIGINATOR_CANCEL, NORMAL_CLEARING curta e atendida longa não classificam (helper nem é chamado com null)', () => {
    expect(classifyHangupForCrm({ hangupCause: 'ORIGINATOR_CANCEL', answeredAt: null, durationSeconds: 0 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: 'NORMAL_CLEARING', answeredAt: ANSWERED, durationSeconds: 15 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: 'NUMBER_CHANGED', answeredAt: ANSWERED, durationSeconds: 30 })).toBeNull();
    expect(classifyHangupForCrm({ hangupCause: 'NO_ANSWER', answeredAt: ANSWERED, durationSeconds: 5 })).toBeNull();
  });

  it('modo shadow ou off: não escreve, mesmo com NUMBER_CHANGED would_apply', () => {
    const classification = classify('NUMBER_CHANGED');
    const decision = would(classification);
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'shadow', decision, classification })).toBe(false);
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'off', decision, classification })).toBe(false);
  });

  it('SDR já registrou ou fluxo antigo da IA: não escreve', () => {
    const classification = classify('NUMBER_CHANGED');
    const already = decideHangupCrm({ classification, call: { ...call, sdr_disposition: 'no_answer' } });
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'live', decision: already, classification })).toBe(false);
    const legacy = decideHangupCrm({ classification, call: { ...call, legacy_ai_outcome_applied: true } });
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'live', decision: legacy, classification })).toBe(false);
  });

  it('sem lead: não escreve', () => {
    const classification = classify('USER_BUSY');
    const decision = decideHangupCrm({ classification, call: { ...call, lead_id: null } });
    expect(decision.verdict).toBe('skip');
    expect(shouldApplyLiveHangupNoAnswer({ mode: 'live', decision, classification })).toBe(false);
  });
});
