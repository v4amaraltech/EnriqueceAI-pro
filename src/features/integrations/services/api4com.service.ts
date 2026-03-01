import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  Api4ComCallListResponse,
  Api4ComHangupResponse,
  Api4ComOriginateResponse,
} from '../types/api4com';

interface Api4ComCredentials {
  apiKey: string;
  baseUrl: string;
  ramal: string;
}

async function getCredentials(userId: string): Promise<Api4ComCredentials | null> {
  const supabase = createServiceRoleClient();

  const { data } = (await (supabase
    .from('api4com_connections' as never) as ReturnType<typeof supabase.from>)
    .select('api_key_encrypted, base_url, ramal')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_key_encrypted: string | null; base_url: string; ramal: string } | null;
  };

  if (!data?.api_key_encrypted) return null;

  return {
    apiKey: data.api_key_encrypted,
    baseUrl: data.base_url.replace(/\/$/, ''),
    ramal: data.ramal,
  };
}

async function api4comFetch<T>(
  creds: Api4ComCredentials,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const url = `${creds.baseUrl}${path}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: creds.apiKey,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API4COM ${method} ${path} failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<T>;
}

/**
 * Initiate a call via API4COM.
 * Connects the user's extension (ramal) to the given phone number.
 */
export async function originateCall(
  userId: string,
  phone: string,
  metadata?: Record<string, string>,
): Promise<{ data: Api4ComOriginateResponse; ramal: string }> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const data = await api4comFetch<Api4ComOriginateResponse>(creds, 'POST', '/dialer', {
    extension: creds.ramal,
    phone,
    metadata: metadata ?? {},
  });

  return { data, ramal: creds.ramal };
}

/**
 * Hangup an active call.
 * Returns gracefully if the call already ended (404).
 */
export async function hangupCall(
  userId: string,
  api4comCallId: string,
): Promise<Api4ComHangupResponse> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const url = `${creds.baseUrl}/calls/${api4comCallId}/hangup`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: creds.apiKey,
    },
  });

  // 404 = call already ended — not an error
  if (response.status === 404) {
    return { status: 'ended', message: 'Chamada já encerrada', id: api4comCallId };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API4COM POST /calls/${api4comCallId}/hangup failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<Api4ComHangupResponse>;
}

/**
 * List calls from API4COM with optional filter.
 */
export async function listCalls(
  userId: string,
  page: number = 1,
  filter?: Record<string, unknown>,
): Promise<Api4ComCallListResponse> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const params = new URLSearchParams({ page: String(page) });
  if (filter) {
    params.set('filter', JSON.stringify(filter));
  }

  return api4comFetch<Api4ComCallListResponse>(creds, 'GET', `/calls?${params.toString()}`);
}

/**
 * Register a webhook URL on API4COM to receive call events.
 */
export async function registerWebhook(
  userId: string,
  webhookUrl: string,
  gateway: string,
): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  await api4comFetch(creds, 'PATCH', '/integrations', {
    gateway,
    webhook: true,
    webhookConstraint: { gateway },
    metadata: {
      webhookUrl,
      webhookVersion: '1.8',
      webhookTypes: ['channel-hangup'],
    },
  });
}
