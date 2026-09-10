import { describe, expect, it } from 'vitest';

import { calculateEffectiveness } from './call-statistics.service';

type Row = Parameters<typeof calculateEffectiveness>[0][number];

const ANSWERED = '2026-09-10T12:00:00Z';

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: crypto.randomUUID(),
    user_id: 'sdr-a',
    status: 'not_connected',
    duration_seconds: 0,
    answered_at: null,
    sdr_disposition: null,
    hangup_cause: null,
    recording_url: null,
    started_at: ANSWERED,
    ...overrides,
  };
}

const members = new Map([
  ['sdr-a', 'Ana'],
  ['sdr-b', 'Bruno'],
]);

describe('calculateEffectiveness', () => {
  it('org sem sinal de telefonia (caso Julio Cesar): atendidas e relevantes vêm do SDR', () => {
    const calls = [
      row({ duration_seconds: 140, sdr_disposition: 'relevant_conversation' }),
      row({ duration_seconds: 50, sdr_disposition: 'answered_no_progress' }),
      row({ duration_seconds: 20, sdr_disposition: 'voicemail' }),
      row({ duration_seconds: 25 }),
    ];

    const { summary, funnel } = calculateEffectiveness(calls, members);

    expect(summary.totalCalls).toBe(4);
    expect(summary.answeredCalls).toBe(2);
    expect(summary.relevantCalls).toBe(1);
    expect(summary.relevantRate).toBe(25);
    expect(summary.withoutDispositionCalls).toBe(1);
    // Taxa de conexão segue só a telefonia — e avisa que ela está muda.
    expect(summary.connectedCalls).toBe(0);
    expect(summary.connectionRate).toBe(0);
    expect(summary.hasTelephonyAnswerSignal).toBe(false);
    expect(funnel.map((s) => [s.label, s.count])).toEqual([
      ['Discadas', 4],
      ['Atendidas', 2],
      ['Conversa relevante', 1],
    ]);
  });

  it('Taxa de conexão = regra canônica; atendidas sem desfecho ficam visíveis', () => {
    const calls = [
      row({ duration_seconds: 180, answered_at: ANSWERED }), // conectada, sem desfecho
      row({ duration_seconds: 8, answered_at: ANSWERED }), // máquina (< 50s)
      row({ duration_seconds: 200, answered_at: ANSWERED, sdr_disposition: 'voicemail' }),
      row({ duration_seconds: 30, sdr_disposition: 'callback_requested' }), // SDR confirma
    ];

    const { summary } = calculateEffectiveness(calls, members);

    expect(summary.connectedCalls).toBe(1);
    expect(summary.connectionRate).toBe(25);
    expect(summary.hasTelephonyAnswerSignal).toBe(true);
    expect(summary.answeredCalls).toBe(2);
    expect(summary.answeredWithoutDispositionCalls).toBe(1);
  });

  it('quebra por SDR com o mesmo critério, ordenada por volume', () => {
    const calls = [
      row({ user_id: 'sdr-a' }),
      row({ user_id: 'sdr-b', sdr_disposition: 'relevant_conversation' }),
      row({ user_id: 'sdr-b', sdr_disposition: 'no_answer' }),
      row({ user_id: 'sdr-c' }),
    ];

    const { bySdr } = calculateEffectiveness(calls, members);

    expect(bySdr.map((r) => r.userName)).toEqual(['Bruno', 'Ana', 'Desconhecido']);
    expect(bySdr[0]).toMatchObject({
      totalCalls: 2,
      answeredCalls: 1,
      relevantCalls: 1,
      relevantRate: 50,
      withoutDispositionCalls: 0,
    });
    expect(bySdr[1]).toMatchObject({ totalCalls: 1, withoutDispositionCalls: 1, withoutDispositionRate: 100 });
  });

  it('tabela de desfechos: todas as opções na ordem fixa + "Sem desfecho", somando o total', () => {
    const calls = [
      row({ sdr_disposition: 'relevant_conversation' }),
      row({ sdr_disposition: 'voicemail' }),
      row({ sdr_disposition: 'voicemail' }),
      row(),
    ];

    const { dispositions } = calculateEffectiveness(calls, members);

    expect(dispositions.map((d) => [d.label, d.count, d.percentage])).toEqual([
      ['Conversa relevante', 1, 25],
      ['Atendeu, sem avanço', 0, 0],
      ['Pediu para ligar depois', 0, 0],
      ['Caixa postal', 2, 50],
      ['Não atendeu', 0, 0],
      ['Falha técnica', 0, 0],
      ['Sem desfecho marcado', 1, 25],
    ]);
    expect(dispositions.reduce((s, d) => s + d.count, 0)).toBe(calls.length);
  });

  it('período vazio: tudo zero, sem divisão por zero', () => {
    const { summary, funnel, bySdr } = calculateEffectiveness([], members);
    expect(summary.connectionRate).toBe(0);
    expect(summary.relevantRate).toBe(0);
    expect(funnel.every((s) => s.count === 0 && s.percentage === 0)).toBe(true);
    expect(bySdr).toEqual([]);
  });
});
