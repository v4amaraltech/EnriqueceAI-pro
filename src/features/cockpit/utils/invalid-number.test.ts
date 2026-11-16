import { describe, expect, it } from 'vitest';

import { isInvalidNumberError } from './invalid-number';

describe('isInvalidNumberError (A-D12)', () => {
  it.each([
    ['API4COM POST /calls failed (422): numero invalido', true],
    ['API4COM POST /calls failed (422)', true],
    ['Telefone inválido', true],
    ['telefone invalido', true],
    ['API4COM POST /calls failed (424): not registered', false],
    ['API4COM POST /calls failed (401): token', false],
    ['API4COM POST /calls failed (500)', false],
    ['Seu ramal não está registrado na API4COM.', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (msg, expected) => {
    expect(isInvalidNumberError(msg)).toBe(expected);
  });
});
