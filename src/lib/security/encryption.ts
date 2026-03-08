import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

/**
 * Returns the 32-byte encryption key from TOKEN_ENCRYPTION_KEY env var.
 * In production, throws if not configured. In dev, returns null (graceful degradation).
 */
function getKey(): Buffer | null {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[SECURITY] TOKEN_ENCRYPTION_KEY is required in production — cannot store OAuth tokens in plaintext');
    }
    return null;
  }
  return Buffer.from(hex, 'hex');
}

/**
 * Checks if a string looks like an encrypted value (iv:authTag:ciphertext).
 */
function isEncrypted(value: string): boolean {
  const parts = value.split(':');
  if (parts.length !== 3) return false;
  const [iv, tag, ct] = parts;
  // IV = 12 bytes = 24 hex chars, authTag = 16 bytes = 32 hex chars, ciphertext >= 0 hex chars
  return (
    iv !== undefined &&
    tag !== undefined &&
    ct !== undefined &&
    iv.length === IV_LENGTH * 2 &&
    tag.length === AUTH_TAG_LENGTH * 2 &&
    /^[0-9a-f]+$/.test(iv) &&
    /^[0-9a-f]+$/.test(tag) &&
    (ct.length === 0 || /^[0-9a-f]+$/.test(ct))
  );
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * If TOKEN_ENCRYPTION_KEY is not set, returns plaintext (graceful degradation).
 * If the value is already encrypted, returns it as-is.
 */
export function encrypt(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts an AES-256-GCM encrypted string.
 *
 * If TOKEN_ENCRYPTION_KEY is not set, returns the value as-is.
 * If the value is plaintext (not in iv:tag:ciphertext format), returns it as-is (backward compat).
 */
export function decrypt(value: string): string {
  const key = getKey();
  if (!key) return value;
  if (!isEncrypted(value)) return value;

  const [ivHex, authTagHex, ciphertextHex] = value.split(':') as [string, string, string];

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}

/**
 * Encrypts a JSON-serializable object.
 * Returns the encrypted string representation.
 */
export function encryptJson<T>(data: T): string {
  return encrypt(JSON.stringify(data));
}

/**
 * Decrypts a string back into a JSON object.
 * Handles both encrypted strings and plaintext JSON (backward compat).
 */
export function decryptJson<T>(value: string): T {
  const decrypted = decrypt(value);
  return JSON.parse(decrypted) as T;
}
