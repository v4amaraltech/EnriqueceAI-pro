'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

/**
 * Test Gmail/Calendar OAuth connection by making a lightweight API call.
 */
export async function testGmailConnection(): Promise<ActionResult<{ ok: boolean; email?: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: conn } = (await from(supabase, 'gmail_connections')
    .select('access_token_encrypted, refresh_token_encrypted, email_address')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as {
    data: { access_token_encrypted: string; refresh_token_encrypted: string; email_address: string } | null;
  };

  if (!conn) {
    return { success: true, data: { ok: false } };
  }

  try {
    const accessToken = decrypt(conn.access_token_encrypted);
    const res = await fetch('https://www.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.ok) {
      return { success: true, data: { ok: true, email: conn.email_address } };
    }

    // Token might be expired — try refresh
    if (res.status === 401) {
      return { success: true, data: { ok: false } };
    }

    return { success: true, data: { ok: false } };
  } catch {
    return { success: true, data: { ok: false } };
  }
}

/**
 * Test API4COM connection by checking the integrations endpoint.
 */
export async function testApi4ComConnection(): Promise<ActionResult<{ ok: boolean; ramal?: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { data: conn } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url, ramal')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle()) as {
    data: { api_key_encrypted: string; base_url: string; ramal: string } | null;
  };

  if (!conn) {
    return { success: true, data: { ok: false } };
  }

  try {
    const apiKey = decrypt(conn.api_key_encrypted);
    const baseUrl = conn.base_url.replace(/\/+$/, '');
    const res = await fetch(`${baseUrl}/integrations`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    });

    return { success: true, data: { ok: res.ok, ramal: conn.ramal } };
  } catch {
    return { success: true, data: { ok: false } };
  }
}
