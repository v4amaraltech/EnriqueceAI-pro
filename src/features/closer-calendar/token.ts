import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { encrypt, isEncryptionConfigured } from '@/lib/security/encryption';

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function createInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashSecret(raw) };
}

export function createOAuthNonce(): { nonce: string; hash: string } {
  const nonce = randomBytes(32).toString('base64url');
  return { nonce, hash: hashSecret(nonce) };
}

export function sealOAuthToken(value: string): { ok: true; ciphertext: string } | { ok: false; error: string } {
  if (!isEncryptionConfigured()) {
    return { ok: false, error: 'TOKEN_ENCRYPTION_KEY não configurada' };
  }
  const ciphertext = encrypt(value);
  if (!ciphertext || ciphertext === value) {
    return { ok: false, error: 'Falha ao criptografar o token' };
  }
  return { ok: true, ciphertext };
}
