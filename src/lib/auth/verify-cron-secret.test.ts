import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { verifyCronSecret } from './verify-cron-secret';

const ORIGINAL = process.env.CRON_SECRET;

function reqWith(token: string | null): Request {
  const headers = new Headers();
  if (token !== null) headers.set('authorization', `Bearer ${token}`);
  return new Request('https://app.test/api/cron/x', { method: 'POST', headers });
}

describe('verifyCronSecret', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = ORIGINAL;
  });

  it('accepts the single configured token', () => {
    process.env.CRON_SECRET = 'super-secret-value-123';
    expect(verifyCronSecret(reqWith('super-secret-value-123'))).toBe(true);
    expect(verifyCronSecret(reqWith('wrong'))).toBe(false);
  });

  it('accepts ANY token in a comma-separated list (rotation window)', () => {
    process.env.CRON_SECRET = 'old-secret-value-000,new-secret-value-111';
    expect(verifyCronSecret(reqWith('old-secret-value-000'))).toBe(true);
    expect(verifyCronSecret(reqWith('new-secret-value-111'))).toBe(true);
    expect(verifyCronSecret(reqWith('neither-of-them'))).toBe(false);
  });

  it('tolerates spaces around list entries', () => {
    process.env.CRON_SECRET = ' old-secret-value-000 , new-secret-value-111 ';
    expect(verifyCronSecret(reqWith('new-secret-value-111'))).toBe(true);
  });

  it('rejects when no secret is configured or no auth header is sent', () => {
    expect(verifyCronSecret(reqWith('anything'))).toBe(false); // no env
    process.env.CRON_SECRET = 'super-secret-value-123';
    expect(verifyCronSecret(reqWith(null))).toBe(false); // no header
  });
});
