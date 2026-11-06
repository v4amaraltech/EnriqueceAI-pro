import { describe, expect, it } from 'vitest';

import { isAutoEmailTemplate } from './internal-templates';

describe('isAutoEmailTemplate', () => {
  it('reconhece os templates internos da cadência automática', () => {
    expect(isAutoEmailTemplate('Auto Email - Step 1')).toBe(true);
    expect(isAutoEmailTemplate('Auto Email - Step 3 (B)')).toBe(true);
  });

  it('não esconde templates criados por pessoas', () => {
    expect(isAutoEmailTemplate('1º E-mail [REATIVAÇÃO].')).toBe(false);
    expect(isAutoEmailTemplate('Meu Auto Email - Step 1')).toBe(false);
  });
});
