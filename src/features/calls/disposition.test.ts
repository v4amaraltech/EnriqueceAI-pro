import { describe, expect, it } from 'vitest';

import {
  DISPOSITION_OPTIONS,
  dispositionOptionsForTelemetry,
  mapDispositionToAction,
} from './disposition';

describe('mapDispositionToAction', () => {
  it('advances on a real conversation', () => {
    expect(mapDispositionToAction('relevant_conversation')).toBe('advance');
    expect(mapDispositionToAction('answered_no_progress')).toBe('advance');
  });

  it('reschedules only when the lead asked for a callback', () => {
    // callback_requested = o lead ATENDEU e pediu para ligar depois — há horário.
    expect(mapDispositionToAction('callback_requested')).toBe('reschedule');
  });

  it('advances on no answer — a cadência cuida da retentativa', () => {
    // Regressão: reagendar aqui obrigava o SDR a escolher uma data no caso mais
    // comum do dia. Ninguém falou com ninguém, então não há retorno combinado.
    expect(mapDispositionToAction('no_answer')).toBe('advance');
  });

  it('does nothing on a technical failure', () => {
    expect(mapDispositionToAction('technical_failure')).toBe('none');
  });

  it('advances on voicemail — caixa postal segue a cadência, como "não atendeu"', () => {
    expect(mapDispositionToAction('voicemail')).toBe('advance');
  });

  it('exposes all six dispositions as options', () => {
    expect(DISPOSITION_OPTIONS).toHaveLength(6);
    expect(DISPOSITION_OPTIONS.map((o) => o.value)).toEqual([
      'relevant_conversation',
      'answered_no_progress',
      'voicemail',
      'callback_requested',
      'no_answer',
      'technical_failure',
    ]);
    expect(DISPOSITION_OPTIONS.find((o) => o.value === 'voicemail')?.label).toBe('Caixa postal');
    expect(DISPOSITION_OPTIONS.find((o) => o.value === 'no_answer')?.label).toBe('Não atendeu');
  });
});

describe('dispositionOptionsForTelemetry', () => {
  it('atendida: oferece conversa + caixa postal + falha técnica, mas NÃO "Não atendeu"', () => {
    const values = dispositionOptionsForTelemetry(true).map((o) => o.value);
    expect(values).toEqual([
      'relevant_conversation',
      'answered_no_progress',
      'voicemail',
      'callback_requested',
      'technical_failure',
    ]);
    expect(values).not.toContain('no_answer');
  });

  it('não atendida: oferece só "Não atendeu" e "Falha técnica" — sem os que exigem atendimento', () => {
    const values = dispositionOptionsForTelemetry(false).map((o) => o.value);
    expect(values).toEqual(['no_answer', 'technical_failure']);
    // Caixa postal também exige que a linha tenha atendido — fora da não atendida.
    for (const forbidden of ['relevant_conversation', 'answered_no_progress', 'callback_requested', 'voicemail'] as const) {
      expect(values).not.toContain(forbidden);
    }
  });

  it('"Falha técnica" (technical_failure) fica disponível nos dois casos', () => {
    expect(dispositionOptionsForTelemetry(true).map((o) => o.value)).toContain('technical_failure');
    expect(dispositionOptionsForTelemetry(false).map((o) => o.value)).toContain('technical_failure');
  });
});
