'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { decrypt, encrypt } from '@/lib/security/encryption';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

interface GmailConnection {
  id: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  token_expires_at: string;
  email_address: string;
  custom_signature: string | null;
  status: string;
}

async function refreshAccessToken(
  connection: GmailConnection,
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
): Promise<{ accessToken: string } | { error: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? '';

  if (!clientId || !clientSecret) {
    return { error: 'Google OAuth não configurado' };
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decrypt(connection.refresh_token_encrypted),
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    return { error: 'Falha ao renovar token Gmail' };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await from(supabase, 'gmail_connections')
    .update({
      access_token_encrypted: encrypt(tokens.access_token),
      token_expires_at: expiresAt,
      status: 'connected',
    } as Record<string, unknown>)
    .eq('id', connection.id);

  return { accessToken: tokens.access_token };
}

export async function fetchGmailSignature(): Promise<ActionResult<string>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return { success: true, data: '' };
  const { orgId, userId, supabase } = auth.data;

  const { data: connection } = (await from(supabase, 'gmail_connections')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .in('status', ['connected', 'error'])
    .single()) as { data: GmailConnection | null };

  if (!connection) {
    return { success: true, data: '' };
  }

  // Priority: custom signature > Gmail API
  if (connection.custom_signature) {
    return { success: true, data: connection.custom_signature };
  }

  let accessToken = decrypt(connection.access_token_encrypted);
  if (connection.status === 'error' || new Date(connection.token_expires_at) < new Date()) {
    const refreshResult = await refreshAccessToken(connection, supabase);
    if ('error' in refreshResult) {
      return { success: true, data: '' };
    }
    accessToken = refreshResult.accessToken;
  }

  try {
    const sigResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs/${encodeURIComponent(connection.email_address)}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (sigResponse.ok) {
      const sigData = (await sigResponse.json()) as { signature?: string };
      if (sigData.signature) {
        return { success: true, data: sigData.signature };
      }
    }
  } catch {
    // Signature fetch failed — return empty
  }

  return { success: true, data: '' };
}
