import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  Api4ComCallListResponse,
  Api4ComHangupResponse,
  Api4ComOriginateResponse,
} from '../types/api4com';
import {
  CALL_WEBHOOK_DEFAULT_URL,
  CALL_WEBHOOK_DEFAULT_VERSION,
  findCallWebhookIntegration,
  planCallWebhookRepair,
} from './api4com-call-webhook';

interface Api4ComCredentials {
  apiKey: string;
  baseUrl: string;
  ramal: string;
}

async function getCredentials(userId: string): Promise<Api4ComCredentials | null> {
  const supabase = createServiceRoleClient();

  const { data } = (await from(supabase, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url, ramal')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_key_encrypted: string | null; base_url: string; ramal: string } | null;
  };

  if (!data?.api_key_encrypted) return null;

  return {
    apiKey: decrypt(data.api_key_encrypted),
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
  const TIMEOUT_MS = 10_000;
  const MAX_RETRIES = 2;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: creds.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`API4COM ${method} ${path} failed (${response.status}): ${text}`);
      }

      return response.json() as Promise<T>;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isNetworkError = lastError.message === 'fetch failed' || lastError.name === 'AbortError' || lastError.name === 'TimeoutError';
      console.warn(`[api4com] ${method} ${path} attempt ${attempt}/${MAX_RETRIES + 1} failed:`, lastError.message);
      // Only retry on network errors (not on auth/4xx/5xx from API4COM)
      if (!isNetworkError) break;
      if (attempt <= MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  // Translate cryptic 'fetch failed' into actionable message
  if (lastError?.message === 'fetch failed' || lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError') {
    throw new Error('Não foi possível conectar à API4COM. Tente novamente em instantes.');
  }
  throw lastError ?? new Error('API4COM request failed');
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

  // Diagnostic log to confirm response shape. Webhook payload.id never matches
  // the .id stored in calls.metadata.api4com_call_id — suspect /dialer returns
  // a request_id but webhook fires with channel_id. Logging the full response
  // so we can see if API4COM returns an additional channelId/callId field we
  // are currently ignoring via the narrow Api4ComOriginateResponse type.
  // Loga só as CHAVES da resposta (não o payload) — basta para a investigação
  // do id-mismatch (channelId/callId extra) sem despejar dados da chamada no log.
  console.warn('[api4com][originate-response] keys:', Object.keys(data ?? {}));

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
    signal: AbortSignal.timeout(10_000),
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
 * Garante que a conta API4COM do usuário entregue os eventos de ligação:
 * integração gateway `webhook` SEM filtro (cria se faltar; liga/tira filtro se
 * precisar). NUNCA toca em outra integração — ver `planCallWebhookRepair`.
 *
 * Histórico: de mai a set/2026 esta função fazia PATCH na PRIMEIRA integração
 * da conta, trocando a `webhookUrl` dela pela nossa e filtrando por gateway. Em
 * vários ramais essa era a integração do CRM (amoCRM, Salesforce) — a entrega
 * de eventos do CRM era sobrescrita — e mesmo assim não funcionava para nós: o
 * filtro barrava as ligações do discador (`gateway: flux-{orgId}`). O que
 * entrega de fato é a integração `webhook` sem filtro (diagnóstico de 10/set).
 *
 * Verificação + retry mantidos (caso do ramal 1045, ago/2026: PATCH que "não
 * pegou"). O cron `reregister-api4com-webhooks` é a rede de segurança diária.
 */
const WEBHOOK_REGISTER_MAX_ATTEMPTS = 3;

export async function ensureCallWebhook(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const target = { webhookUrl: CALL_WEBHOOK_DEFAULT_URL, webhookVersion: CALL_WEBHOOK_DEFAULT_VERSION };

  let lastError: unknown;
  for (let attempt = 1; attempt <= WEBHOOK_REGISTER_MAX_ATTEMPTS; attempt++) {
    try {
      const integrations = await api4comFetch<unknown[]>(creds, 'GET', '/integrations');
      const plan = planCallWebhookRepair(Array.isArray(integrations) ? integrations : [], target);
      if (plan.action === 'noop') return;

      await api4comFetch(creds, 'PATCH', '/integrations', plan.body);

      // Verificação: relê e confirma que a `webhook` ficou ligada e sem filtro.
      const verify = await api4comFetch<unknown[]>(creds, 'GET', '/integrations');
      const after = findCallWebhookIntegration(Array.isArray(verify) ? verify : []);
      if (after && planCallWebhookRepair([after], target).action === 'noop') return;

      throw new Error('Integração webhook não confirmada após PATCH');
    } catch (err) {
      lastError = err;
      if (attempt < WEBHOOK_REGISTER_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Falha ao configurar a entrega de eventos da API4COM após múltiplas tentativas');
}
