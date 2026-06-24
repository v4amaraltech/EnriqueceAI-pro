import { describe, expect, it } from 'vitest';

import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it('strips non-digit characters', () => {
    expect(normalizePhone('(71) 99905-8397')).toBe('71999058397');
  });

  it('collapses a duplicated Brazilian country code (5555…)', () => {
    expect(normalizePhone('55557199058397')).toBe('557199058397');
  });

  it('returns empty string for null (malformed enrichment JSONB)', () => {
    expect(() => normalizePhone(null)).not.toThrow();
    expect(normalizePhone(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(() => normalizePhone(undefined)).not.toThrow();
    expect(normalizePhone(undefined)).toBe('');
  });

  it('returns empty string for an empty string', () => {
    expect(normalizePhone('')).toBe('');
  });
});
