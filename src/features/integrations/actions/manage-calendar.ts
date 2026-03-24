'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { encrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

import type { CalendarConnectionSafe } from '../types';

function getGcalClientId() {
  return process.env.GCAL_CLIENT_ID ?? '';
}
function getGcalClientSecret() {
  return process.env.GCAL_CLIENT_SECRET ?? '';
}
function getGcalRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  return `${appUrl}/api/auth/callback/calendar`;
}

export async function getCalendarAuthUrl(): Promise<ActionResult<{ url: string }>> {
  await requireAuth();

  const clientId = getGcalClientId();
  if (!clientId) {
    return { success: false, error: 'Configuração do Google Calendar OAuth não encontrada' };
  }

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.freebusy',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getGcalRedirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  });

  return {
    success: true,
    data: { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` },
  };
}

export async function handleCalendarCallback(
  code: string,
): Promise<ActionResult<CalendarConnectionSafe>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const clientId = getGcalClientId();
  const clientSecret = getGcalClientSecret();
  if (!clientId || !clientSecret) {
    return { success: false, error: 'Configuração do Google Calendar OAuth não encontrada' };
  }

  // Exchange code for tokens
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: getGcalRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenResponse.ok) {
    return { success: false, error: 'Erro ao autenticar com Google Calendar' };
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

  // Encrypt access token
  const encryptedAccessToken = encrypt(tokens.access_token);

  // Preserve existing refresh_token if Google didn't send a new one (happens on re-auth)
  let encryptedRefreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token) : '';
  if (!encryptedRefreshToken) {
    const { data: existing } = (await from(supabase, 'calendar_connections')
      .select('refresh_token_encrypted')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle()) as { data: { refresh_token_encrypted: string } | null };
    encryptedRefreshToken = existing?.refresh_token_encrypted ?? '';
  }

  // Upsert connection
  const { data, error } = (await from(supabase, 'calendar_connections')
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
    )
    .select('id, calendar_email, status, created_at, updated_at')
    .single()) as { data: CalendarConnectionSafe | null; error: { message: string } | null };

  if (error) {
    return { success: false, error: 'Erro ao salvar conexão Google Calendar' };
  }

  return { success: true, data: data! };
}

export async function disconnectCalendar(): Promise<ActionResult<{ disconnected: boolean }>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  const { error } = await from(supabase, 'calendar_connections')
    .delete()
    .eq('org_id', orgId)
    .eq('user_id', userId);

  if (error) {
    return { success: false, error: 'Erro ao desconectar Google Calendar' };
  }

  return { success: true, data: { disconnected: true } };
}
