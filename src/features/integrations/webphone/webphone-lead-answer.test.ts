import { describe, expect, it } from 'vitest';

import { leadAnswerFromCallRow } from './webphone-lead-answer';

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
