import { describe, expect, it } from 'vitest';

import { readLeadsQuerySchema } from './read-leads.schemas';

describe('readLeadsQuerySchema', () => {
  it('applies defaults when params are absent', () => {
    const r = readLeadsQuerySchema.parse({});
    expect(r.page).toBe(1);
    expect(r.per_page).toBe(50);
    expect(r.status).toBeUndefined();
  });

  it('coerces numeric strings', () => {
    const r = readLeadsQuerySchema.parse({ page: '3', per_page: '25' });
    expect(r.page).toBe(3);
    expect(r.per_page).toBe(25);
  });

  it('caps per_page at 100', () => {
    expect(readLeadsQuerySchema.safeParse({ per_page: '500' }).success).toBe(false);
  });

  it('rejects page < 1', () => {
    expect(readLeadsQuerySchema.safeParse({ page: '0' }).success).toBe(false);
  });

  it('parses a comma-separated status list', () => {
    const r = readLeadsQuerySchema.parse({ status: 'new,contacted' });
    expect(r.status).toEqual(['new', 'contacted']);
  });

  it('rejects an invalid status value', () => {
    expect(readLeadsQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
  });

  it('rejects a non-ISO updated_since', () => {
    expect(readLeadsQuerySchema.safeParse({ updated_since: '2026-06-21' }).success).toBe(false);
  });

  it('accepts a valid ISO updated_since', () => {
    const r = readLeadsQuerySchema.parse({ updated_since: '2026-06-21T12:00:00Z' });
    expect(r.updated_since).toBe('2026-06-21T12:00:00Z');
  });
});
