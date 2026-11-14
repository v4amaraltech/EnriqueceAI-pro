import { describe, expect, it } from 'vitest';

import { buildCallOutcomeView, type CallOutcomeRow, dispositionLabel } from './call-outcome-view';

const row = (over: Partial<CallOutcomeRow> = {}): CallOutcomeRow => ({
  answered_at: '2026-11-07T12:00:05Z',
  hangup_cause: 'NORMAL_CLEARING',
  duration_seconds: 60,
  sdr_disposition: null,
  notes: null,
  transcription_status: 'completed',
  metadata: null,
  ...over,
});

describe('buildCallOutcomeView', () => {
  it('ligação sem sinal do webhook: aguardando', () => {
    expect(buildCallOutcomeView(row({ answered_at: null, hangup_cause: null, duration_seconds: 0 }))).toEqual({ state: 'waiting_call' });
  });

  it('não atendida: sem espera de resumo', () => {
    expect(buildCallOutcomeView(row({ answered_at: null, hangup_cause: 'NO_ANSWER', duration_seconds: 0, metadata: { ai_outcome: { status: 'pending' } } }))).toEqual({
      state: 'not_answered',
      hangupCause: 'NO_ANSWER',
    });
  });

  it('transcrição pendente: estado provisório de transcrição', () => {
    expect(buildCallOutcomeView(row({ transcription_status: 'processing', metadata: { ai_outcome: { status: 'pending' } } }))).toEqual({
      state: 'pending',
      stage: 'transcription',
    });
  });

  it('transcrita e aguardando a IA: classificação pendente', () => {
    expect(buildCallOutcomeView(row({ metadata: { ai_outcome: { status: 'processing' } } }))).toEqual({ state: 'pending', stage: 'classification' });
  });

  it('IA com confiança suficiente: resultado confirmado com resumo e retorno agendado', () => {
    const v = buildCallOutcomeView(
      row({
        metadata: {
          ai_outcome: { status: 'done', disposition: 'callback_requested', confidence: 0.9, summary: 'Pediu retorno', callback_at: '2026-11-08T12:00:00Z', scheduled_activity_id: 's1', needs_review: false },
        },
      }),
    );
    expect(v).toEqual({
      state: 'confirmed',
      source: 'ai',
      disposition: 'callback_requested',
      summary: 'Pediu retorno',
      callbackAt: '2026-11-08T12:00:00Z',
      callbackScheduled: true,
    });
  });

  it('baixa confiança retida vira exceção, não resultado', () => {
    const v = buildCallOutcomeView(
      row({ metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.4, summary: 'Talvez', needs_review: true, applied: false } } }),
    );
    expect(v).toEqual({ state: 'exception', reason: 'low_confidence', suggestedDisposition: 'relevant_conversation', confidence: 0.4, summary: 'Talvez' });
  });

  it('falha da IA vira exceção', () => {
    expect(buildCallOutcomeView(row({ metadata: { ai_outcome: { status: 'failed', needs_review: true } } }))).toMatchObject({ state: 'exception', reason: 'failed' });
  });

  it('correção humana vence a sugestão da IA', () => {
    const v = buildCallOutcomeView(
      row({ sdr_disposition: 'answered_no_progress', metadata: { ai_outcome: { status: 'done', disposition: 'relevant_conversation', confidence: 0.4, applied: false, needs_review: true, summary: 'Resumo IA' } } }),
    );
    expect(v).toMatchObject({ state: 'confirmed', source: 'sdr', disposition: 'answered_no_progress', summary: 'Resumo IA' });
  });

  it('é pura: a mesma linha dá sempre o mesmo estado', () => {
    const r = row({ metadata: { ai_outcome: { status: 'done', disposition: 'voicemail', confidence: 0.95, summary: 'Caixa postal', needs_review: false } } });
    expect(buildCallOutcomeView(r)).toEqual(buildCallOutcomeView(r));
  });
});

describe('dispositionLabel com Fora de área', () => {
  it('no_answer com NUMBER_CHANGED ou SUBSCRIBER_ABSENT aparece como Fora de área', () => {
    expect(dispositionLabel('no_answer', 'NUMBER_CHANGED')).toBe('Fora de área');
    expect(dispositionLabel('no_answer', 'SUBSCRIBER_ABSENT')).toBe('Fora de área');
  });
  it('sem causa de fora de área continua Não atendeu; falha técnica não muda', () => {
    expect(dispositionLabel('no_answer', 'NO_ANSWER')).toBe('Não atendeu');
    expect(dispositionLabel('no_answer')).toBe('Não atendeu');
    expect(dispositionLabel('technical_failure', 'UNALLOCATED_NUMBER')).not.toBe('Fora de área');
  });
});
