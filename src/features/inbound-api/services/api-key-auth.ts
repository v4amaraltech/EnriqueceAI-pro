import { createServiceRoleClient } from '@/lib/supabase/service';

import { hashApiKey, resolveApiKey } from './api-key.service';

interface AuthResult {
  orgId: string;
  keyId: string;
}

/**
 * Authenticate an API request by extracting and validating the API key.
 * Supports `Authorization: Bearer <key>` header or `?token=<key>` query param.
 * Uses service role client to bypass RLS.
 */
export async function authenticateApiKey(request: Request): Promise<AuthResult | null> {
  const key = extractApiKey(request);
  if (!key) return null;

  const supabase = createServiceRoleClient();
  const keyHash = hashApiKey(key);
  const apiKey = await resolveApiKey(keyHash, supabase);

  if (!apiKey) return null;

  return { orgId: apiKey.org_id, keyId: apiKey.id };
}

function extractApiKey(request: Request): string | null {
  // 1. Try Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Try query param
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token) return token;

  return null;
}
