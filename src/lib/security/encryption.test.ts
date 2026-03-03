import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { decrypt, decryptJson, encrypt, encryptJson } from './encryption';

// 32-byte key in hex (64 chars)
const TEST_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('encryption', () => {
  beforeEach(() => {
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', TEST_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('encrypt/decrypt round-trip', () => {
    it('encrypts and decrypts a simple string', () => {
      const plaintext = 'my-secret-token';
      const encrypted = encrypt(plaintext);

      expect(encrypted).not.toBe(plaintext);
      expect(encrypted.split(':')).toHaveLength(3);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('encrypts and decrypts unicode content', () => {
      const plaintext = 'Token com acentuação: ão, ê, ü — e emoji: 🔐';
      const encrypted = encrypt(plaintext);
      expect(decrypt(encrypted)).toBe(plaintext);
    });

    it('encrypts and decrypts empty string', () => {
      const encrypted = encrypt('');
      expect(decrypt(encrypted)).toBe('');
    });

    it('produces different ciphertext for the same plaintext (random IV)', () => {
      const plaintext = 'same-token';
      const a = encrypt(plaintext);
      const b = encrypt(plaintext);
      expect(a).not.toBe(b);
      expect(decrypt(a)).toBe(plaintext);
      expect(decrypt(b)).toBe(plaintext);
    });
  });

  describe('backward compatibility (plaintext passthrough)', () => {
    it('decrypt returns plaintext strings unchanged', () => {
      const plaintext = 'ya29.a0ARrdaM_some_google_token';
      expect(decrypt(plaintext)).toBe(plaintext);
    });

    it('decrypt returns JSON strings unchanged', () => {
      const json = '{"access_token":"abc","refresh_token":"def"}';
      expect(decrypt(json)).toBe(json);
    });

    it('encrypt does not double-encrypt an already-encrypted value', () => {
      const plaintext = 'my-token';
      const encrypted = encrypt(plaintext);
      const doubleEncrypted = encrypt(encrypted);
      expect(doubleEncrypted).toBe(encrypted);
    });
  });

  describe('graceful degradation (no key)', () => {
    beforeEach(() => {
      vi.stubEnv('TOKEN_ENCRYPTION_KEY', '');
    });

    it('encrypt returns plaintext when key is not set', () => {
      const plaintext = 'my-token';
      expect(encrypt(plaintext)).toBe(plaintext);
    });

    it('decrypt returns value as-is when key is not set', () => {
      const value = 'some-value';
      expect(decrypt(value)).toBe(value);
    });
  });

  describe('tamper detection', () => {
    it('throws on tampered ciphertext', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      // Flip a character in the ciphertext
      const tampered = parts[2]!;
      const flipped = tampered[0] === 'a' ? 'b' + tampered.slice(1) : 'a' + tampered.slice(1);
      const tamperedEncrypted = `${parts[0]}:${parts[1]}:${flipped}`;

      expect(() => decrypt(tamperedEncrypted)).toThrow();
    });

    it('throws on tampered auth tag', () => {
      const encrypted = encrypt('secret');
      const parts = encrypted.split(':');
      const tampered = parts[1]!;
      const flipped = tampered[0] === 'a' ? 'b' + tampered.slice(1) : 'a' + tampered.slice(1);
      const tamperedEncrypted = `${parts[0]}:${flipped}:${parts[2]}`;

      expect(() => decrypt(tamperedEncrypted)).toThrow();
    });
  });

  describe('encryptJson/decryptJson', () => {
    it('round-trips a JSON object', () => {
      const data = {
        access_token: 'ya29.abc',
        refresh_token: '1//def',
        token_expires_at: '2026-01-01T00:00:00Z',
      };
      const encrypted = encryptJson(data);
      expect(typeof encrypted).toBe('string');
      expect(encrypted).not.toContain('ya29.abc');

      const decrypted = decryptJson<typeof data>(encrypted);
      expect(decrypted).toEqual(data);
    });

    it('decryptJson handles plaintext JSON (backward compat)', () => {
      const json = '{"access_token":"abc","refresh_token":"def"}';
      const result = decryptJson<{ access_token: string; refresh_token: string }>(json);
      expect(result.access_token).toBe('abc');
      expect(result.refresh_token).toBe('def');
    });
  });
});
