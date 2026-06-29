import { beforeAll, describe, expect, it } from 'vitest';

import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token';

beforeAll(() => {
  process.env.UNSUBSCRIBE_SIGNING_SECRET = 'test-secret-for-unsubscribe-tokens';
});

describe('unsubscribe-token', () => {
  const LEAD = '11111111-1111-1111-1111-111111111111';

  it('round-trips lead id + email', () => {
    const token = signUnsubscribeToken(LEAD, 'foo@bar.com');
    expect(verifyUnsubscribeToken(token)).toEqual({ leadId: LEAD, email: 'foo@bar.com' });
  });

  it('lowercases the email in the token', () => {
    const token = signUnsubscribeToken(LEAD, 'USER@Example.COM');
    expect(verifyUnsubscribeToken(token)?.email).toBe('user@example.com');
  });

  it('preserves emails containing special chars', () => {
    const token = signUnsubscribeToken(LEAD, 'a.b+tag_1@sub.example.com');
    expect(verifyUnsubscribeToken(token)?.email).toBe('a.b+tag_1@sub.example.com');
  });

  it('rejects a tampered payload (forged lead/email reusing a valid signature)', () => {
    const token = signUnsubscribeToken(LEAD, 'a@b.com');
    const sig = token.slice(token.lastIndexOf('.') + 1);
    const forged = `${Buffer.from('evil-lead:hacker@evil.com').toString('base64url')}.${sig}`;
    expect(verifyUnsubscribeToken(forged)).toBeNull();
  });

  it('rejects malformed tokens', () => {
    expect(verifyUnsubscribeToken('garbage')).toBeNull();
    expect(verifyUnsubscribeToken('')).toBeNull();
    expect(verifyUnsubscribeToken('a.b.c')).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signUnsubscribeToken(LEAD, 'a@b.com');
    process.env.UNSUBSCRIBE_SIGNING_SECRET = 'a-different-secret';
    expect(verifyUnsubscribeToken(token)).toBeNull();
    process.env.UNSUBSCRIBE_SIGNING_SECRET = 'test-secret-for-unsubscribe-tokens';
  });
});
