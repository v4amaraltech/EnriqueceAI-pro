import { describe, expect, it } from 'vitest';

import { isUuid } from './uuid';

describe('isUuid', () => {
  it('accepts canonical UUIDs (case-insensitive)', () => {
    expect(isUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(isUuid('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects non-UUID strings', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false); // 1 char short
    expect(isUuid('550e8400e29b41d4a716446655440000')).toBe(false); // no dashes
    expect(isUuid('')).toBe(false);
    expect(isUuid('leads')).toBe(false);
  });
});
