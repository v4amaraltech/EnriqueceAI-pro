import { describe, expect, it } from 'vitest';

import { parseSkippedCadenceName, SKIPPED_ENROLL_PATTERN, skippedEnrollError } from './enroll-skip-format';

const LEAD_ID = '123e4567-e89b-12d3-a456-426614174000';

describe('enroll-skip-format', () => {
  it('mantém exatamente a mensagem atual', () => {
    expect(skippedEnrollError('L1', 'Standard A')).toBe('Lead L1: já está na cadência "Standard A"');
  });

  it.each([
    'Standard A',
    'Inbound "2.0"',
    'Reativação — Ação & Cia',
    'Cadência (nova) 100%',
    'A&B%20C',
    'com "aspas" no "fim"',
  ])('ida e volta devolve o nome: %s', (name) => {
    expect(parseSkippedCadenceName(skippedEnrollError(LEAD_ID, name))).toBe(name);
  });

  it('o ID do lead não aparece no trecho capturado', () => {
    const captured = parseSkippedCadenceName(skippedEnrollError(LEAD_ID, 'Standard A'));
    expect(captured).not.toContain(LEAD_ID);
    expect(SKIPPED_ENROLL_PATTERN.exec(skippedEnrollError(LEAD_ID, 'Standard A'))?.[1]).not.toContain(LEAD_ID);
  });

  it('nome vazio, quebra de linha ou outro formato => null, sem exceção', () => {
    expect(parseSkippedCadenceName(skippedEnrollError('L1', ''))).toBeNull();
    expect(parseSkippedCadenceName(skippedEnrollError('L1', 'linha1\nlinha2'))).toBeNull();
    expect(parseSkippedCadenceName('Lead L1: não encontrado')).toBeNull();
    expect(parseSkippedCadenceName('')).toBeNull();
  });
});
