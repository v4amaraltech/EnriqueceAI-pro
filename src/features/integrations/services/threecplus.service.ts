import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  ThreeCPlusConnectResponse,
  ThreeCPlusHangupResponse,
  ThreeCPlusManualCallResponse,
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
    if (response.status === 403) {
      throw new Error('Acesso negado pela 3CPlus. Verifique se o token e a extensão estão corretos e se o agente está conectado na plataforma.');
    }
    if (response.status === 401) {
      throw new Error('Token da 3CPlus inválido ou expirado. Reconfigure em Integrações.');
    }
    if (response.status === 422) {
      // Extract detail message from 3CPlus JSON error
      let detail = text;
      try {
        const parsed = JSON.parse(text) as { detail?: string };
        if (parsed.detail) detail = parsed.detail;
      } catch { /* use raw text */ }
      throw new Error(`3CPlus (${path}): ${detail}`);
    }
    throw new Error(`3CPlus ${method} ${path} falhou (${response.status}): ${text}`);
  }

  // Some endpoints return empty body (e.g. /agent/connect) — handle gracefully
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Normalize phone number to Brazilian format: 55 + DDD + number (digits only).
 * Input can be: "(71) 997302987", "71997302987", "5571997302987", etc.
 */
function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Already has country code 55
  if (digits.startsWith('55') && digits.length >= 12) return digits;
  // Just DDD + number
  return `55${digits}`;
}

/**
 * Step 1: Connect the agent on 3CPlus.
 * Must be called before making any calls.
 */
export async function connectAgent(
  userId: string,
): Promise<ThreeCPlusConnectResponse> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  return threecplusFetch<ThreeCPlusConnectResponse>(creds, 'POST', '/agent/connect');
}

/**
 * Step 2: Enter manual call mode.
 * Required before dialing a manual call.
 */
export async function enterManualMode(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  await threecplusFetch<unknown>(creds, 'POST', '/agent/manual_call/enter');
}

/**
 * Fetch available campaigns for the agent and login to the first one in manual mode.
 * Required before entering manual call mode.
 */
export async function loginToManualMode(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  // Fetch campaigns to get a valid campaign ID
  interface CampaignGroup {
    campaigns?: Array<{ id: number; name: string }>;
    [key: string]: unknown;
  }
  const groups = await threecplusFetch<CampaignGroup[]>(creds, 'GET', '/groups-and-campaigns');

  // Find first available campaign
  let campaignId: number | null = null;
  for (const group of groups) {
    const first = group.campaigns?.[0];
    if (first) { campaignId = first.id; break; }
  }

  if (!campaignId) {
    throw new Error('Nenhuma campanha encontrada na sua conta 3CPlus. Crie uma campanha no painel da 3CPlus.');
  }

  // Login to campaign in manual mode
  await threecplusFetch<unknown>(creds, 'POST', '/agent/login', {
    campaign: campaignId,
    mode: 'manual',
  });
}

/**
 * Step 3: Initiate a manual call via 3CPlus.
 * Flow: connectAgent → enterManualMode → dialManualCall.
 * Phone format: "5571997302987" (country code + DDD + number).
 */
export async function dialManualCall(
  userId: string,
  phone: string,
): Promise<{ data: ThreeCPlusManualCallResponse; extension: string }> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  const normalizedPhone = normalizePhone(phone);

  const data = await threecplusFetch<ThreeCPlusManualCallResponse>(
    creds,
    'POST',
    '/agent/manual_call/dial',
    { phone: normalizedPhone },
  );

  return { data, extension: creds.extension };
}

/**
 * Exit manual call mode after finishing calls.
 */
export async function exitManualMode(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurada para este usuário');

  await threecplusFetch<unknown>(creds, 'POST', '/agent/manual_call/exit');
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
