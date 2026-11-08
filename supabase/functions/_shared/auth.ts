// Auth helpers for Edge Functions
import { supabaseAdmin } from './supabase-admin.ts';

interface AuthContext {
  userId: string;
  organizationId: string;
}

type AuthResult =
  | { ok: true; context: AuthContext }
  | { ok: false; response: Response };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

/**
 * Validate JWT from Authorization header and resolve the user's organization.
 * Uses service-role client to bypass RLS.
 */
export async function getAuthContext(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Missing Authorization header' }),
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  const token = authHeader.replace('Bearer ', '');

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(token);

  if (error || !user) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        { status: 401, headers: CORS_HEADERS },
      ),
    };
  }

  // Resolve the user's active organization membership.
  // NOTE: uses "organization_members" (the real table).
  // A view "org_members" also exists as an alias for backwards-compat.
  const { data: member, error: memberError } = await supabaseAdmin
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single();

  if (memberError || !member) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: 'User is not an active member of any organization' }),
        { status: 403, headers: CORS_HEADERS },
      ),
    };
  }

  return {
    ok: true,
    context: { userId: user.id, organizationId: member.org_id },
  };
}

/**
 * Validate the Evolution webhook secret header.
 */
export function validateWebhookSecret(req: Request): boolean {
  const secret =
    req.headers.get('X-EVOLUTION-SECRET') ||
    req.headers.get('x-evolution-secret') ||
    '';
  const expectedSecret = Deno.env.get('EVOLUTION_WEBHOOK_SECRET') || '';
  return secret !== '' && secret === expectedSecret;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function jwtRole(token: string): string | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    return (JSON.parse(json) as { role?: string }).role ?? null;
  } catch {
    return null;
  }
}

/**
 * Autoriza chamadas internas (cron/scheduler) às edge functions Evolution.
 * Aceita `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` ou um item da lista
 * CRON_SECRET (separada por vírgula), em tempo constante.
 *
 * `allowLegacyAnon`: transição para crons antigos que enviam o JWT anon (público).
 * Aceita o JWT anon com WARNING. Remover na fase 2 depois que os crons migrarem.
 */
export function isInternalCaller(req: Request, opts: { allowLegacyAnon?: boolean } = {}): boolean {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;

  const candidates = [
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    ...(Deno.env.get('CRON_SECRET') ?? '').split(',').map((t) => t.trim()),
  ].filter((t) => t.length > 0);

  let ok = false;
  for (const c of candidates) {
    if (timingSafeEqualStr(token, c)) ok = true;
  }
  if (ok) return true;

  if (opts.allowLegacyAnon && jwtRole(token) === 'anon') {
    console.warn('[auth] chamada interna com JWT anon (legado); migrar o cron para service_role/CRON_SECRET');
    return true;
  }
  return false;
}
