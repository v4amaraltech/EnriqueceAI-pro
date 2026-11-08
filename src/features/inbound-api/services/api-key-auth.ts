import { createServiceRoleClient } from '@/lib/supabase/service';

import { hashApiKey, resolveApiKey } from './api-key.service';

interface AuthResult {
  orgId: string;
  keyId: string;
  scopes: string[];
}

interface AuthOptions {
  /** Escopo exigido (ex.: 'leads.write'). `*` na chave vale para todos. Ausente = não checa. */
  requiredScope?: string;
  /** Aceita `?token=` na URL (aparece em logs de acesso). Padrão true por compatibilidade. */
  allowQueryToken?: boolean;
}

/** Pista 23: a chave possui o escopo exigido? Chave sem escopos não tem nenhum. */
export function hasScope(scopes: string[] | null | undefined, required: string): boolean {
  if (!Array.isArray(scopes)) return false;
  return scopes.includes('*') || scopes.includes(required);
}

/**
 * Authenticate an API request by extracting and validating the API key.
 * Supports `Authorization: Bearer <key>` header or `?token=<key>` query param.
 * Uses service role client to bypass RLS.
 */
export async function authenticateApiKey(request: Request, options: AuthOptions = {}): Promise<AuthResult | null> {
  const key = extractApiKey(request, options.allowQueryToken ?? true);
  if (!key) return null;

  const supabase = createServiceRoleClient();
  const keyHash = hashApiKey(key);
  const apiKey = await resolveApiKey(keyHash, supabase);

  if (!apiKey) return null;

  if (options.requiredScope && !hasScope(apiKey.scopes, options.requiredScope)) return null;

  return { orgId: apiKey.org_id, keyId: apiKey.id, scopes: apiKey.scopes ?? [] };
}

function extractApiKey(request: Request, allowQueryToken: boolean): string | null {
  // 1. Try Authorization header
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }

  // 2. Try query param
  if (!allowQueryToken) return null;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (token) return token;

  return null;
}
