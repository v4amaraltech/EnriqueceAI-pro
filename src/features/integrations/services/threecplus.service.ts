import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  ThreeCPlusClick2CallResponse,
  ThreeCPlusHangupResponse,
} from '../types/threecplus';

interface ThreeCPlusCredentials {
  apiToken: string;
  baseUrl: string;
  extension: string;
}

async function getCredentials(userId: string): Promise<ThreeCPlusCredentials | null> {
  const supabase = createServiceRoleClient();

  const { data } = (await (supabase
    .from('threecplus_connections' as never) as ReturnType<typeof supabase.from>)
    .select('api_token_encrypted, base_url, extension')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_token_encrypted: string | null; base_url: string; extension: string } | null;
  };

  if (!data?.api_token_encrypted) return null;

  return {
    apiToken: data.api_token_encrypted,
    baseUrl: data.base_url.replace(/\/$/, ''),
    extension: data.extension,
  };
}

async function threecplusFetch<T>(
  creds: ThreeCPlusCredentials,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${creds.baseUrl}${path}${separator}api_token=${creds.apiToken}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`3CPlus ${method} ${path} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Initiate a call via 3CPlus click2call.
 * Connects the user's extension to the given phone number.
 */
export async function click2call(
  userId: string,
  phone: string,
): Promise<{ data: ThreeCPlusClick2CallResponse; extension: string }> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  const data = await threecplusFetch<ThreeCPlusClick2CallResponse>(creds, 'POST', '/click2call', {
    extension: creds.extension,
    phone,
  });

  return { data, extension: creds.extension };
}

/**
 * Hangup an active call via 3CPlus.
 */
export async function hangupCall(
  userId: string,
  callId: string,
): Promise<ThreeCPlusHangupResponse> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  return threecplusFetch<ThreeCPlusHangupResponse>(
    creds,
    'POST',
    `/agent/call/${callId}/hangup`,
  );
}
