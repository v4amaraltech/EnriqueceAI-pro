import { describe, expect, it } from 'vitest';

import type { CallConnectionSignals } from './connection';
import { isAnsweredByPersonCall, isRelevantConversationCall } from './effectiveness';
import type { CallDisposition } from './types';

const ANSWERED = '2026-09-10T12:00:00Z';

function call(overrides: Partial<CallConnectionSignals> = {}): CallConnectionSignals {
  return { status: 'not_connected', duration_seconds: 0, answered_at: null, sdr_disposition: null, ...overrides };
}

describe('isAnsweredByPersonCall', () => {
  it('conta quando a telefonia confirma conversa (answered + >= 50s)', () => {
    expect(isAnsweredByPersonCall(call({ duration_seconds: 120, answered_at: ANSWERED }))).toBe(true);
  });

  it('conta quando o SDR confirma atendimento humano, mesmo sem sinal da telefonia', () => {
    // Caso da org Julio Cesar (set/2026): webhook API4COM nunca chegou.
    for (const d of ['relevant_conversation', 'answered_no_progress', 'callback_requested'] as const) {
      expect(isAnsweredByPersonCall(call({ duration_seconds: 20, sdr_disposition: d }))).toBe(true);
    }
  });

  it('NUNCA conta caixa postal, nem com answered_at e duração longa', () => {
    expect(
      isAnsweredByPersonCall(call({ duration_seconds: 300, answered_at: ANSWERED, sdr_disposition: 'voicemail' })),
    ).toBe(false);
  });

  it('não conta "não atendeu" nem "falha técnica" sem confirmação da telefonia', () => {
    for (const d of ['no_answer', 'technical_failure'] as const) {
      expect(isAnsweredByPersonCall(call({ duration_seconds: 90, sdr_disposition: d }))).toBe(false);
    }
  });

  it('não conta duração longa sem answered_at (tempo chamando / aviso da operadora)', () => {
    expect(isAnsweredByPersonCall(call({ duration_seconds: 90 }))).toBe(false);
  });

  it('não conta atendimento curto sem desfecho (< 50s = máquina)', () => {
    expect(isAnsweredByPersonCall(call({ duration_seconds: 10, answered_at: ANSWERED }))).toBe(false);
  });
});

describe('isRelevantConversationCall', () => {
  it('só conta o desfecho "Conversa relevante" marcado pelo SDR', () => {
    expect(isRelevantConversationCall({ sdr_disposition: 'relevant_conversation' })).toBe(true);
    expect(isRelevantConversationCall({ sdr_disposition: 'answered_no_progress' })).toBe(false);
    expect(isRelevantConversationCall({ sdr_disposition: null })).toBe(false);
  });

  it('toda conversa relevante também é atendida (funil nunca inverte)', () => {
    const dispositions: Array<CallDisposition | null> = [
      null,
      'relevant_conversation',
      'answered_no_progress',
      'callback_requested',
      'no_answer',
      'technical_failure',
      'voicemail',
    ];
    for (const d of dispositions) {
      for (const answered_at of [null, ANSWERED]) {
        for (const duration_seconds of [0, 30, 60]) {
          const c = call({ sdr_disposition: d, answered_at, duration_seconds });
          if (isRelevantConversationCall(c)) expect(isAnsweredByPersonCall(c)).toBe(true);
        }
      }
    }
  });
});
