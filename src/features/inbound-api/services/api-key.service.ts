import crypto from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import type { ApiKeyRow } from '../types';

interface GeneratedKey {
  key: string;
  hash: string;
  prefix: string;
}

/**
 * Generate a new API key with format `enr_k_{random}`.
 * Returns the plaintext key (shown once), its SHA-256 hash, and 8-char prefix.
 */
export function generateApiKey(): GeneratedKey {
  const randomBytes = crypto.randomBytes(32).toString('base64url');
  const key = `enr_k_${randomBytes}`;
  const hash = hashApiKey(key);
  const prefix = key.slice(0, 12);
  return { key, hash, prefix };
}

/** SHA-256 hex digest of an API key */
export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Resolve an API key hash to its row. Validates is_active and expires_at.
 * Updates last_used_at on success.
 * Returns the row or null if invalid.
 */
export async function resolveApiKey(
  keyHash: string,
  supabase: SupabaseClient,
): Promise<ApiKeyRow | null> {
  const { data } = await from(supabase, 'api_keys')
    .select('*')
    .eq('key_hash', keyHash)
    .single() as { data: ApiKeyRow | null };

  if (!data) return null;
  if (!data.is_active) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;

  // Fire-and-forget: update last_used_at
  from(supabase, 'api_keys')
    .update({ last_used_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('id', data.id)
    .then(({ error }) => { if (error) console.error('[api-key] Failed to update last_used_at:', error); })
    .catch((err: unknown) => console.error('[api-key] last_used_at update error:', err));

  return data;
}
