import { describe, expect, it } from 'vitest';

import { toE164BR } from './phone';

describe('toE164BR', () => {
  it('prefixes 55 on a local mobile (DDD + 9 digits)', () => {
    expect(toE164BR('11954958486')).toBe('5511954958486');
  });

  it('prefixes 55 on a local landline (DDD + 8 digits)', () => {
    expect(toE164BR('1140041234')).toBe('551140041234');
  });

  it('keeps a number already in E.164 BR (13 digits)', () => {
    expect(toE164BR('5511954958486')).toBe('5511954958486');
  });

  it('keeps a number already in E.164 BR (12 digits, landline)', () => {
    expect(toE164BR('551140041234')).toBe('551140041234');
  });

  it('strips formatting before normalizing', () => {
    expect(toE164BR('(11) 95495-8486')).toBe('5511954958486');
  });

  it('handles a DDD 55 mobile without double-prefixing', () => {
    // DDD 55 (RS) + 9 dígitos = 11 dígitos locais → 55 + 55 + número
    expect(toE164BR('55999998888')).toBe('5555999998888');
  });

  it('returns empty for blank input', () => {
    expect(toE164BR('')).toBe('');
    expect(toE164BR('abc')).toBe('');
  });
});
