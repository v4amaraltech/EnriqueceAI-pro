import { describe, expect, it } from 'vitest';

import { parseLeadsPerPage } from './leads-per-page';

describe('parseLeadsPerPage', () => {
  it('padrão 25 quando ausente ou inválido', () => {
    expect(parseLeadsPerPage(undefined)).toBe(25);
    expect(parseLeadsPerPage('abc')).toBe(25);
    expect(parseLeadsPerPage('10')).toBe(25);
    expect(parseLeadsPerPage('500')).toBe(25);
  });
  it('aceita 25, 50 e 100', () => {
    expect(parseLeadsPerPage('25')).toBe(25);
    expect(parseLeadsPerPage('50')).toBe(50);
    expect(parseLeadsPerPage('100')).toBe(100);
  });
});
