import { decrypt } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

import type {
  ThreeCPlusCampaign,
  ThreeCPlusCampaignsResponse,
  ThreeCPlusManualCallResponse,
} from '../types/threecplus';

interface ThreeCPlusCredentials {
  apiToken: string;
  domain: string;
  login: string;
}

function baseUrl(domain: string): string {
  return `https://${domain}.3cplus.com.br/api/v1`;
}

export async function getCredentials(userId: string): Promise<ThreeCPlusCredentials | null> {
  const supabase = createServiceRoleClient();

  const { data } = (await from(supabase, 'threecplus_connections' as never)
    .select('api_token_encrypted, domain, login')
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as {
    data: { api_token_encrypted: string | null; domain: string; login: string } | null;
  };

  if (!data?.api_token_encrypted) return null;

  return {
    apiToken: decrypt(data.api_token_encrypted),
    domain: data.domain,
    login: data.login,
  };
}

/**
 * 3CPlus API uses api_token as a query parameter for authentication.
 */
async function threecplusFetch<T>(
  creds: ThreeCPlusCredentials,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${baseUrl(creds.domain)}${path}${separator}api_token=${encodeURIComponent(creds.apiToken)}`;

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
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
 * Validate an API token by making a test call to /agent/campaigns.
 * Throws with the actual API error if the token is invalid.
 */
export async function validateToken(domain: string, apiToken: string): Promise<void> {
  const url = `${baseUrl(domain)}/agent/campaigns?api_token=${encodeURIComponent(apiToken)}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`(${response.status}) ${text}`);
  }
}

/**
 * Get available campaigns for the agent.
 */
export async function getCampaigns(userId: string): Promise<ThreeCPlusCampaign[]> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  const result = await threecplusFetch<ThreeCPlusCampaignsResponse>(creds, 'GET', '/agent/campaigns');
  return result.data;
}

/**
 * Login agent to a campaign.
 */
export async function agentLogin(userId: string, campaignId: number): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', '/agent/login', {
    campaign_id: campaignId,
  });
}

/**
 * Webphone login — required before receiving audio via WebRTC.
 */
export async function agentWebphoneLogin(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', '/agent/webphone/login');
}

/**
 * Logout agent from current campaign.
 */
export async function agentLogout(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', '/agent/logout');
}

/**
 * Enter manual call mode.
 */
export async function manualCallEnter(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', '/agent/manual_call/enter');
}

/**
 * Dial a number in manual call mode.
 */
export async function manualCallDial(
  userId: string,
  phone: string,
): Promise<ThreeCPlusManualCallResponse> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  return threecplusFetch<ThreeCPlusManualCallResponse>(creds, 'POST', '/agent/manual_call/dial', {
    phone,
  });
}

/**
 * Exit manual call mode.
 */
export async function manualCallExit(userId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', '/agent/manual_call/exit');
}

/**
 * Hangup a specific call by its ID.
 */
export async function hangupCall(userId: string, callId: string): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', `/agent/call/${encodeURIComponent(callId)}/hangup`);
}

/**
 * Qualify (disposition) a call after it ends.
 */
export async function qualifyCall(
  userId: string,
  callId: string,
  qualificationId: number,
): Promise<void> {
  const creds = await getCredentials(userId);
  if (!creds) throw new Error('3CPlus não configurado para este usuário');

  await threecplusFetch(creds, 'POST', `/agent/call/${encodeURIComponent(callId)}/qualify`, {
    qualification_id: qualificationId,
  });
}
