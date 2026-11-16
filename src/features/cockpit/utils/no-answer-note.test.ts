import { describe, expect, it } from 'vitest';

import { buildNoAnswerNote } from './no-answer-note';

describe('buildNoAnswerNote (A-D9)', () => {
  it('formato curto em horário de Brasília', () => {
    expect(buildNoAnswerNote('2026-11-13T15:00:00Z', 3)).toBe('13/11 12h00: não atendeu (tentativa 3/3).');
    expect(buildNoAnswerNote(new Date('2026-11-13T22:59:00Z'), 3)).toBe('13/11 19h59: não atendeu (tentativa 3/3).');
  });
  it('vira o dia pelo fuso (02:30Z = 23h30 do dia anterior em Brasília)', () => {
    expect(buildNoAnswerNote('2026-11-14T02:30:00Z', 2)).toBe('13/11 23h30: não atendeu (tentativa 2/3).');
    expect(buildNoAnswerNote('2026-01-01T02:05:00Z', 1)).toBe('31/12 23h05: não atendeu (tentativa 1/3).');
  });
  it('zeros à esquerda e máximo configurável', () => {
    expect(buildNoAnswerNote('2026-03-05T11:07:00Z', 1, 5)).toBe('05/03 08h07: não atendeu (tentativa 1/5).');
  });
});
