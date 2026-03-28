'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import { decrypt, encrypt } from '@/lib/security/encryption';

import { GOOGLE_TOKEN_URL } from '../constants/oauth-endpoints';
import type { GmailConnectionSafe } from '../types';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI ?? '';

export async function getGmailAuthUrl(
  redirectAfter?: string,
): Promise<ActionResult<{ url: string }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_REDIRECT_URI) {
    return { success: false, error: 'Configuração do Google OAuth não encontrada' };
  }

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    ...(redirectAfter ? { state: redirectAfter } : {}),
  });

  return {
    success: true,
    data: { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  };
}

export async function handleGmailCallback(
  code: string,
): Promise<ActionResult<GmailConnectionSafe>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    return { success: false, error: 'Configuração do Google OAuth não encontrada' };
  }

  // Exchange code for tokens
  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    return { success: false, error: 'Erro ao autenticar com Google' };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  if (!tokens.access_token) {
    return { success: false, error: 'Token de acesso não recebido' };
  }

  // Get user email
  const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    return { success: false, error: 'Erro ao obter informações do usuário' };
  }

  const userInfo = (await userInfoResponse.json()) as { email: string };
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  // Preserve existing refresh_token if Google didn't send a new one (happens on re-auth)
  let refreshToken = tokens.refresh_token ?? '';
  if (!refreshToken) {
    const { data: existing } = (await from(supabase, 'gmail_connections')
      .select('refresh_token_encrypted')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()) as { data: { refresh_token_encrypted: string } | null };
    // Existing value may already be encrypted — keep as-is for storage
    refreshToken = existing?.refresh_token_encrypted ?? '';
  }

  const encryptedAccessToken = encrypt(tokens.access_token);
  const encryptedRefreshToken = refreshToken ? encrypt(refreshToken) : '';

  // Upsert connection
  const { data, error } = (await from(supabase, 'gmail_connections')
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: expiresAt,
        email_address: userInfo.email,
        status: 'connected',
      } as Record<string, unknown>,
      { onConflict: 'org_id,user_id' },
    )
    .select('id, email_address, status, created_at, updated_at')
    .single()) as { data: GmailConnectionSafe | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao salvar conexão Gmail' };
  }

  // Also save calendar connection (same tokens, unified OAuth)
  await from(supabase, 'calendar_connections')
    .upsert(
      {
        org_id: orgId,
        user_id: userId,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: expiresAt,
        calendar_email: userInfo.email,
        status: 'connected',
      } as Record<string, unknown>,
      { onConflict: 'org_id,user_id' },
    );

  revalidatePath('/settings/integrations');
  return { success: true, data: data! };
}

export async function disconnectGmail(): Promise<ActionResult<{ disconnected: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'gmail_connections')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: 'Erro ao desconectar Gmail' };
  }

  // Also disconnect calendar (unified OAuth)
  await from(supabase, 'calendar_connections')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  revalidatePath('/settings/integrations');
  return { success: true, data: { disconnected: true } };
}

export async function refreshGmailToken(
  connectionId: string,
): Promise<ActionResult<{ refreshed: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId, supabase } = auth.data;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return { success: false, error: 'Configuração do Google OAuth não encontrada' };
  }

  // Fetch current connection (needs refresh token)
  const { data: connection } = (await from(supabase, 'gmail_connections')
    .select('*')
    .eq('id', connectionId)
    .eq('user_id', userId)
    .single()) as { data: { refresh_token_encrypted: string } | null };

  if (!connection) {
    return { success: false, error: 'Conexão não encontrada' };
  }

  const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: decrypt(connection.refresh_token_encrypted),
      grant_type: 'refresh_token',
    }),
  });

  if (!tokenResponse.ok) {
    // Mark connection as error
    await from(supabase, 'gmail_connections')
      .update({ status: 'error' } as Record<string, unknown>)
      .eq('id', connectionId);
    return { success: false, error: 'Erro ao renovar token' };
  }

  const tokens = (await tokenResponse.json()) as {
    access_token: string;
    expires_in: number;
  };

  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  const encryptedNewAccessToken = encrypt(tokens.access_token);

  await from(supabase, 'gmail_connections')
    .update({
      access_token_encrypted: encryptedNewAccessToken,
      token_expires_at: expiresAt,
      status: 'connected',
    } as Record<string, unknown>)
    .eq('id', connectionId);

  // Also refresh calendar token (unified OAuth)
  await from(supabase, 'calendar_connections')
    .update({
      access_token_encrypted: encryptedNewAccessToken,
      token_expires_at: expiresAt,
      status: 'connected',
    } as Record<string, unknown>)
    .eq('user_id', userId);

  return { success: true, data: { refreshed: true } };
}
