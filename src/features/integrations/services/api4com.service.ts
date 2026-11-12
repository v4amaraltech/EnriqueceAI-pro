import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { normalizePhone } from '@/lib/utils/phone';

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
import { isSafeApi4ComBaseUrl } from '@/lib/security/safe-url';

import type { Api4ComExtension } from './api4com-extension-sync';
import { retryWaitMs } from './api4com-rate-limit';

export const API4COM_DEFAULT_BASE_URL = 'https://api.api4com.com/api/v1/';

/** Token + base URL da CONTA (vale para todos os ramais da org). */
export interface Api4ComApiCredentials {
  apiKey: string;
  baseUrl: string;
}

/** Credencial da conta + ramal de um usuário. */
export interface Api4ComCredentials extends Api4ComApiCredentials {
  ramal: string;
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export function normalizeBaseUrl(url: string | null | undefined): string {
  const candidate = (url?.trim() || API4COM_DEFAULT_BASE_URL).replace(/\/+$/, '');
  // Pista 8: o token da org vai no Authorization desta URL. Só https em host da
  // API4COM; qualquer outro valor (inclusive legado no banco) cai no padrão.
  if (!isSafeApi4ComBaseUrl(candidate)) {
    console.warn('[api4com] base_url fora da allowlist, usando o padrão');
    return API4COM_DEFAULT_BASE_URL.replace(/\/+$/, '');
  }
  return candidate;
}

/**
 * Token da organização (`api4com_org_settings`). É a fonte principal desde a
 * story api4com-embedded-webphone: um token da conta pai (`ttl: -1`) para a
 * org inteira, em vez de um token por SDR.
 */
export async function getOrgSettingsCredentials(
  orgId: string,
  client: ServiceClient = createServiceRoleClient(),
): Promise<Api4ComApiCredentials | null> {
  const { data } = (await from(client, 'api4com_org_settings' as never)
    .select('api_key_encrypted, base_url')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { api_key_encrypted: string | null; base_url: string | null } | null };

  if (!data?.api_key_encrypted) return null;
  return { apiKey: decrypt(data.api_key_encrypted), baseUrl: normalizeBaseUrl(data.base_url) };
}

/** A org tem token da conta cadastrado? Não decifra nada — só checa a existência. */
export async function hasOrgApi4ComToken(
  orgId: string,
  client: ServiceClient = createServiceRoleClient(),
): Promise<boolean> {
  const { data } = (await from(client, 'api4com_org_settings' as never)
    .select('id')
    .eq('org_id', orgId)
    .not('api_key_encrypted', 'is', null)
    .maybeSingle()) as { data: { id: string } | null };
  return !!data;
}

/**
 * Credencial da conta para operações por org (reconcile, gravações, webhook):
 * token da org; se a org ainda não tem, o primeiro token de usuário conectado
 * (legado — qualquer token da conta enxerga o domínio inteiro).
 */
export async function getOrgApiCredentials(
  orgId: string,
  client: ServiceClient = createServiceRoleClient(),
): Promise<Api4ComApiCredentials | null> {
  const org = await getOrgSettingsCredentials(orgId, client);
  if (org) return org;

  const { data } = (await from(client, 'api4com_connections' as never)
    .select('api_key_encrypted, base_url')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .not('api_key_encrypted', 'is', null)
    .limit(1)
    .maybeSingle()) as { data: { api_key_encrypted: string | null; base_url: string | null } | null };

  if (!data?.api_key_encrypted) return null;
  return { apiKey: decrypt(data.api_key_encrypted), baseUrl: normalizeBaseUrl(data.base_url) };
}

/**
 * Credencial + ramal de um usuário: ramal da linha dele em
 * `api4com_connections`; token da org quando existe, senão o token da própria
 * linha (legado).
 */
export async function getUserCredentials(userId: string): Promise<Api4ComCredentials | null> {
  const client = createServiceRoleClient();

  const { data } = (await from(client, 'api4com_connections' as never)
    .select('org_id, api_key_encrypted, base_url, ramal')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { org_id: string; api_key_encrypted: string | null; base_url: string | null; ramal: string } | null;
  };

  if (!data?.ramal) return null;

  const org = await getOrgSettingsCredentials(data.org_id, client);
  if (org) return { ...org, ramal: data.ramal };

  if (!data.api_key_encrypted) return null;
  return {
    apiKey: decrypt(data.api_key_encrypted),
    baseUrl: normalizeBaseUrl(data.base_url),
    ramal: data.ramal,
  };
}

interface FetchOptions {
  timeoutMs?: number;
  /** Tentativas extras em erro de rede. Zero para operações que não podem repetir (originar chamada). */
  retries?: number;
}

// Cabeçalhos de espera que a API4COM manda em 429 (e às vezes em 503). Vão no
// texto do erro como `[nome: valor]` para `describeOriginateError` saber quanto
// o SDR deve esperar; sem isso o valor se perdia no `throw`.
const WAIT_HEADERS = ['retry-after', 'ratelimit-reset', 'x-ratelimit-reset'] as const;
const WAIT_HEADER_PATTERN = /\[(retry-after|ratelimit-reset|x-ratelimit-reset): ([^\]]+)\]/gi;

function waitHeadersSuffix(headers: Headers | undefined): string {
  if (!headers || typeof headers.get !== 'function') return '';
  let suffix = '';
  for (const name of WAIT_HEADERS) {
    const value = headers.get(name)?.trim();
    if (value) suffix += ` [${name}: ${value}]`;
  }
  return suffix;
}

/** Espera (ms) pedida pelo servidor, lida dos cabeçalhos anexados ao erro por `api4comFetch`. */
export function waitMsFromErrorMessage(message: string, now = Date.now()): number | null {
  const headers = new Headers();
  for (const match of message.matchAll(WAIT_HEADER_PATTERN)) {
    headers.set(match[1]!.toLowerCase(), match[2]!.trim());
  }
  return retryWaitMs(headers, now);
}

export async function api4comFetch<T>(
  creds: Api4ComApiCredentials,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options: FetchOptions = {},
): Promise<T> {
  const url = `${creds.baseUrl}${path}`;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.retries ?? 2;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: creds.apiKey,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
        // Pista 8: nunca seguir redirect com o token no header.
        redirect: 'manual',
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(
          `API4COM ${method} ${path} failed (${response.status}): ${text}${waitHeadersSuffix(response.headers)}`,
        );
      }

      return response.json() as Promise<T>;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const isNetworkError = lastError.message === 'fetch failed' || lastError.name === 'AbortError' || lastError.name === 'TimeoutError';
      console.warn(`[api4com] ${method} ${path} attempt ${attempt}/${maxRetries + 1} failed:`, lastError.message);
      // Only retry on network errors (not on auth/4xx/5xx from API4COM)
      if (!isNetworkError) break;
      if (attempt <= maxRetries) {
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
 * `called` do `POST /calls`: E.164 com DDI (`+5548988669122`). Números
 * nacionais sem DDI (10 ou 11 dígitos) ganham `+55`.
 */
export function toApi4ComCalled(phone: string): string {
  const digits = normalizePhone(phone);
  if (digits.length < 8) throw new Error('Telefone inválido');
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  return `+${digits}`;
}

// `POST /calls` só responde depois que o Webphone atende (`no_answer_timeout`
// padrão do ramal é 30 s), e o guia da API4COM para o POST /calls pede 90 s de
// timeout no cliente. Sem retry: o guia proíbe repetir quando a resposta HTTP
// não chegou, porque a chamada pode ter nascido (discaria duas vezes).
export const ORIGINATE_TIMEOUT_MS = 90_000;

/**
 * A API4COM devolve 424 "call from {ramal} to {número} has been failed" quando a
 * perna do RAMAL não completou: ele ainda estava ocupado com a ligação anterior
 * (o hangup chega ao provedor alguns segundos depois de o navegador encerrar —
 * visto em produção em 21/10/2026, 15 s entre o fim no webphone e o webhook) ou
 * não estava registrado. Nenhuma chamada nasce nesse caso, então repetir UMA vez
 * é seguro — diferente do timeout, que pode ter discado.
 */
export function isRamalLegFailure(message: string): boolean {
  return /\(424\)/.test(message) && /has been failed/i.test(message);
}

export const RAMAL_LEG_RETRY_DELAY_MS = 3_000;

/** Status HTTP do erro cru de `api4comFetch` (`... failed (429): ...`), ou null. */
function originateErrorStatus(message: string): number | null {
  const match = /^API4COM \S+ \S+ failed \((\d{3})\)/.exec(message);
  return match ? Number(match[1]) : null;
}

function rateLimitMessage(message: string, now: number): string {
  const waitMs = waitMsFromErrorMessage(message, now);
  if (waitMs === null) {
    return 'Muitas tentativas de ligação em pouco tempo. Aguarde um minuto e tente de novo.';
  }
  const seconds = Math.max(1, Math.ceil(waitMs / 1000));
  const unit = seconds === 1 ? 'segundo' : 'segundos';
  return `Muitas tentativas de ligação em pouco tempo. Tente de novo em ${seconds} ${unit}.`;
}

/**
 * Mensagem para o SDR a partir do erro cru do `POST /calls`. Só traduz o texto:
 * não repete a chamada (429 inclusive) e não marca o token como inválido.
 */
export function describeOriginateError(message: string, now = Date.now()): string {
  if (isRamalLegFailure(message)) {
    return 'A API4COM não conseguiu chamar o seu ramal. Se você acabou de desligar, aguarde alguns segundos e tente de novo; se persistir, confira se o webphone está verde.';
  }
  if (/\(424\)/.test(message) && /not registered/i.test(message)) {
    return 'Seu ramal não está registrado na API4COM. Aguarde o webphone ficar verde (ou abra a extensão) e tente de novo.';
  }
  switch (originateErrorStatus(message)) {
    case 401:
      return 'O token da API4COM é inválido ou expirou. Peça ao administrador um novo token e que ele o salve em Integrações, no card da API4COM.';
    case 429:
      return rateLimitMessage(message, now);
    case 404:
      return 'Seu ramal não foi encontrado na API4COM. Peça ao administrador para clicar em "Sincronizar ramais" em Integrações e tente de novo.';
    case 503:
      return 'A API4COM está temporariamente indisponível. Tente de novo em alguns segundos.';
    default:
      return message;
  }
}

/**
 * Originate a call via API4COM (`POST /calls`): toca o ramal do usuário e, ao
 * atender, conecta o número. Substitui o `POST /dialer`, descontinuado pela
 * API4COM — e cujo `id` não batia com o do webhook (daí o worker
 * `back-associate`). O `id` do `/calls` é o mesmo da lista de chamadas e dos
 * eventos `channel-answer`/`channel-hangup`.
 */
export async function originateCall(
  userId: string,
  phone: string,
  metadata?: Record<string, string>,
  options: { ramalRetryDelayMs?: number; credentials?: Api4ComCredentials } = {},
): Promise<{ data: Api4ComOriginateResponse; ramal: string }> {
  // `credentials`: o chamador já buscou (precisa do ramal antes do POST); evita outro fetch.
  const creds = options.credentials ?? (await getUserCredentials(userId));
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const post = () =>
    api4comFetch<Api4ComOriginateResponse>(
      creds,
      'POST',
      '/calls',
      {
        extension: creds.ramal,
        caller: creds.ramal,
        called: toApi4ComCalled(phone),
        metadata: metadata ?? {},
      },
      { timeoutMs: ORIGINATE_TIMEOUT_MS, retries: 0 },
    );

  let data: Api4ComOriginateResponse;
  try {
    data = await post();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!isRamalLegFailure(message)) throw err;
    const delay = options.ramalRetryDelayMs ?? RAMAL_LEG_RETRY_DELAY_MS;
    console.warn(`[api4com] ramal ${creds.ramal} não completou a perna do POST /calls; nova tentativa em ${delay} ms`);
    await new Promise((r) => setTimeout(r, delay));
    data = await post();
  }

  if (!data?.id) {
    throw new Error('API4COM não devolveu o id da chamada');
  }

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
  const creds = await getUserCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const url = `${creds.baseUrl}/calls/${api4comCallId}/hangup`;

  const response = await fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
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
  const creds = await getUserCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');

  const params = new URLSearchParams({ page: String(page) });
  if (filter) {
    params.set('filter', JSON.stringify(filter));
  }

  return api4comFetch<Api4ComCallListResponse>(creds, 'GET', `/calls?${params.toString()}`);
}

/**
 * Ramais da conta (`GET /extensions`): número, senha SIP, domínio e e-mail de
 * cada ramal. É o que permite ligar cada SDR ao seu ramal sem cadastro manual.
 */
export async function listExtensions(creds: Api4ComApiCredentials): Promise<Api4ComExtension[]> {
  const data = await api4comFetch<unknown>(creds, 'GET', '/extensions');
  if (!Array.isArray(data)) {
    throw new Error('API4COM devolveu uma lista de ramais inválida');
  }
  return data as Api4ComExtension[];
}

/**
 * Garante que a conta API4COM entregue os eventos de ligação: integração
 * gateway `webhook` SEM filtro (cria se faltar; liga/tira filtro se precisar).
 * NUNCA toca em outra integração — ver `planCallWebhookRepair`.
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

export async function ensureCallWebhookWithCredentials(creds: Api4ComApiCredentials): Promise<void> {
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

/** Webhook com a credencial do usuário (token da org quando houver). */
export async function ensureCallWebhook(userId: string): Promise<void> {
  const creds = await getUserCredentials(userId);
  if (!creds) throw new Error('API4COM não configurada para este usuário');
  await ensureCallWebhookWithCredentials(creds);
}
