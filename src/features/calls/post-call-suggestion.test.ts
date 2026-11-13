import { describe, expect, it } from 'vitest';

import {
  readAutoUpdateMarkerView,
  readLiveAmdSuggestion,
  resolvePostCallSuggestion,
} from './post-call-suggestion';

describe('resolvePostCallSuggestion', () => {
  it('sem sinal: não pré-seleciona na atendida', () => {
    expect(resolvePostCallSuggestion({ connected: true })).toEqual({
      outcome: null,
      nextActivity: null,
      reason: null,
      source: null,
      alreadyFilled: false,
      alreadyFilledDisposition: null,
      meetingPrefill: null,
    });
  });

  it('live_amd reunião: pré-seleciona conversa relevante e próxima atividade', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      liveAmd: {
        prediction: 'human',
        nextActivity: 'schedule_meeting',
        nextActivityReason: 'Aceitou amanhã às 10.',
        confidence: 0.8,
      },
      meetingPrefill: { closerId: 'closer-1', date: '2026-11-14', time: '10:00' },
    });
    expect(r).toMatchObject({
      outcome: 'relevant_conversation',
      nextActivity: 'schedule_meeting',
      reason: 'Aceitou amanhã às 10.',
      source: 'live_amd',
      alreadyFilled: false,
      meetingPrefill: { closerId: 'closer-1', date: '2026-11-14', time: '10:00' },
    });
  });

  it('live_amd retorno: pré-seleciona pediu para ligar depois', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      liveAmd: {
        prediction: 'human',
        nextActivity: 'schedule_callback',
        nextActivityReason: 'Pediu para ligar depois.',
      },
    });
    expect(r.outcome).toBe('callback_requested');
    expect(r.nextActivity).toBe('schedule_callback');
    expect(r.source).toBe('live_amd');
  });

  it('live_amd não conectou em linha atendida: caixa postal (não inventa not_connected no enum)', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      liveAmd: {
        prediction: 'voicemail',
        nextActivity: 'not_connected',
        nextActivityReason: 'Caiu na caixa postal.',
      },
    });
    expect(r.outcome).toBe('voicemail');
    expect(r.nextActivity).toBe('not_connected');
  });

  it('live_amd número inexistente: falha técnica', () => {
    const r = resolvePostCallSuggestion({
      connected: false,
      liveAmd: { prediction: 'number_not_exist', nextActivity: 'not_connected' },
    });
    expect(r.outcome).toBe('technical_failure');
  });

  it('live_amd só com previsão human, sem próxima atividade: não pré-seleciona', () => {
    const r = resolvePostCallSuggestion({ connected: true, liveAmd: { prediction: 'human' } });
    expect(r.outcome).toBeNull();
    expect(r.source).toBeNull();
  });

  it('não oferece no_answer numa ligação atendida (trava de telemetria)', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      liveAmd: { prediction: 'no_answer', nextActivity: 'not_connected' },
    });
    expect(r.outcome).toBeNull();
    expect(r.nextActivity).toBe('not_connected');
  });

  it('qualificação JEV reunião: conversa relevante', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      qualification: {
        outcome: 'meeting_booked',
        next_step_suggestion: 'meeting',
        confidence: 0.9,
      },
    });
    expect(r).toMatchObject({
      outcome: 'relevant_conversation',
      nextActivity: 'schedule_meeting',
      source: 'qualification',
    });
  });

  it('qualificação JEV callback: pediu para ligar depois', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      qualification: { outcome: 'callback', next_step_suggestion: 'callback' },
    });
    expect(r.outcome).toBe('callback_requested');
    expect(r.nextActivity).toBe('schedule_callback');
  });

  it('qualificação JEV not_connected: caixa postal, nunca atendeu sem avanço', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      qualification: { outcome: 'not_connected', next_step_suggestion: 'not_connected' },
    });
    expect(r.outcome).toBe('voicemail');
    expect(r.nextActivity).toBe('not_connected');
    expect(r.source).toBe('qualification');
  });

  it('marcador de escrita automática vence a sugestão da IA', () => {
    const r = resolvePostCallSuggestion({
      connected: false,
      autoUpdateMarker: {
        applied: true,
        disposition: 'technical_failure',
        rules_version: 'hangup_v1',
      },
      liveAmd: { prediction: 'no_answer', nextActivity: 'not_connected' },
    });
    expect(r).toMatchObject({
      outcome: 'technical_failure',
      alreadyFilled: true,
      alreadyFilledDisposition: 'technical_failure',
      source: 'auto_filled',
      nextActivity: null,
    });
  });

  it('marcador no_answer numa não atendida: já preenchido', () => {
    const r = resolvePostCallSuggestion({
      connected: false,
      sdrDisposition: 'no_answer',
      autoUpdateMarker: { applied: true, disposition: 'no_answer', rules_version: 'hangup_v1' },
    });
    expect(r.alreadyFilled).toBe(true);
    expect(r.alreadyFilledDisposition).toBe('no_answer');
    expect(r.outcome).toBe('no_answer');
  });

  it('sdr_disposition sem marcador não conta como preenchimento automático', () => {
    const r = resolvePostCallSuggestion({
      connected: true,
      sdrDisposition: 'relevant_conversation',
      liveAmd: { prediction: 'human', nextActivity: 'schedule_callback' },
    });
    expect(r.alreadyFilled).toBe(false);
    expect(r.outcome).toBe('callback_requested');
    expect(r.source).toBe('live_amd');
  });
});

describe('readLiveAmdSuggestion e readAutoUpdateMarkerView', () => {
  it('lê o formato gravado em metadata.live_amd', () => {
    expect(
      readLiveAmdSuggestion({
        live_amd: {
          prediction: 'human',
          next_activity_suggestion: 'schedule_meeting',
          next_activity_reason: 'Aceitou a reunião.',
          next_activity_confidence: 0.77,
        },
      }),
    ).toEqual({
      prediction: 'human',
      nextActivity: 'schedule_meeting',
      nextActivityReason: 'Aceitou a reunião.',
      confidence: 0.77,
    });
  });

  it('ignora metadata sem live_amd útil', () => {
    expect(readLiveAmdSuggestion(null)).toBeNull();
    expect(readLiveAmdSuggestion({ foo: 1 })).toBeNull();
    expect(readLiveAmdSuggestion({ live_amd: {} })).toBeNull();
  });

  it('lê o marcador só quando applied é true e há disposition', () => {
    expect(
      readAutoUpdateMarkerView({
        crm_auto_update: {
          applied: true,
          disposition: 'technical_failure',
          rules_version: 'hangup_v1',
        },
      }),
    ).toEqual({
      applied: true,
      disposition: 'technical_failure',
      rules_version: 'hangup_v1',
      source: null,
    });
    expect(
      readAutoUpdateMarkerView({ crm_auto_update: { applied: false, disposition: 'no_answer' } }),
    ).toBeNull();
    expect(readAutoUpdateMarkerView({ ai_outcome: { applied: true } })).toBeNull();
  });
});
