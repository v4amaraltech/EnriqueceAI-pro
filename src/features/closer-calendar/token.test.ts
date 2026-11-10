import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { createInviteToken, createOAuthNonce, hashSecret, sealOAuthToken, secretsMatch } from './token';

const KEY = 'ab'.repeat(32);

describe('token do convite da agenda', () => {
  afterEach(() => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
  });

  it('guarda só o hash e cada convite é único', () => {
    const first = createInviteToken();
    const second = createInviteToken();
    expect(first.raw).not.toBe(first.hash);
    expect(first.hash).toBe(createHash('sha256').update(first.raw).digest('hex'));
    expect(first.raw).not.toBe(second.raw);
    expect(secretsMatch(first.hash, hashSecret(first.raw))).toBe(true);
    expect(secretsMatch(first.hash, second.hash)).toBe(false);
  });

  it('o nonce do OAuth também é hash', () => {
    const nonce = createOAuthNonce();
    expect(nonce.nonce.length).toBeGreaterThanOrEqual(32);
    expect(nonce.hash).toBe(hashSecret(nonce.nonce));
  });

  it('recusa gravar refresh token sem criptografia', () => {
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(sealOAuthToken('refresh-secreto')).toEqual({
      ok: false,
      error: 'TOKEN_ENCRYPTION_KEY não configurada',
    });
  });

  it('criptografa o refresh token e não devolve o texto puro', () => {
    process.env.TOKEN_ENCRYPTION_KEY = KEY;
    const sealed = sealOAuthToken('refresh-secreto');
    expect(sealed.ok).toBe(true);
    if (sealed.ok) {
      expect(sealed.ciphertext).not.toContain('refresh-secreto');
      expect(sealed.ciphertext.split(':')).toHaveLength(3);
    }
  });
});
