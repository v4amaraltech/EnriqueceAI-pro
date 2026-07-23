import { describe, expect, it } from 'vitest';

import { CONNECTED_MIN_DURATION_SECONDS, isConnectedCall, isSignificantCall } from './connection';

describe('isConnectedCall', () => {
  it('conta como conectada quando a conversa foi significativa', () => {
    expect(isConnectedCall({ status: 'significant', duration_seconds: 5, answered_at: null })).toBe(true);
  });

  it('conta como conectada quando o provedor confirmou o atendimento', () => {
    // answered_at é o sinal mais forte — vale mesmo em ligação curta.
    expect(
      isConnectedCall({ status: 'not_significant', duration_seconds: 8, answered_at: '2026-07-22T12:00:00Z' }),
    ).toBe(true);
  });

  it('conta como conectada a partir do piso de duração, sem outros sinais', () => {
    expect(
      isConnectedCall({ status: 'no_contact', duration_seconds: CONNECTED_MIN_DURATION_SECONDS, answered_at: null }),
    ).toBe(true);
  });

  it('NÃO conta como conectada uma not_significant curta sem answered_at', () => {
    // Regressão do bug de escrita do pipeline API4COM: 6.221 linhas em 90 dias
    // com hangup_cause de não-atendimento herdaram status not_significant.
    expect(
      isConnectedCall({ status: 'not_significant', duration_seconds: 0, answered_at: null }),
    ).toBe(false);
    expect(
      isConnectedCall({ status: 'not_significant', duration_seconds: 2, answered_at: null }),
    ).toBe(false);
  });

  it('não conta como conectada logo abaixo do piso de duração', () => {
    expect(
      isConnectedCall({
        status: 'not_connected',
        duration_seconds: CONNECTED_MIN_DURATION_SECONDS - 1,
        answered_at: null,
      }),
    ).toBe(false);
  });

  it('trata answered_at ausente como não informado', () => {
    expect(isConnectedCall({ status: 'no_contact', duration_seconds: 0 })).toBe(false);
  });
});

describe('isSignificantCall', () => {
  it('só aceita o bucket significant', () => {
    expect(isSignificantCall({ status: 'significant' })).toBe(true);
    for (const status of ['not_significant', 'no_contact', 'busy', 'not_connected'] as const) {
      expect(isSignificantCall({ status })).toBe(false);
    }
  });

  it('é sempre um subconjunto de conectadas', () => {
    // Guarda contra a regressão em que significantRate era literalmente
    // atribuído a connectionRate, exibindo dois cards idênticos.
    const call = { status: 'significant', duration_seconds: 1, answered_at: null } as const;
    expect(isSignificantCall(call)).toBe(true);
    expect(isConnectedCall(call)).toBe(true);
  });
});
