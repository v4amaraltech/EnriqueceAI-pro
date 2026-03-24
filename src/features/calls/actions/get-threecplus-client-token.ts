'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { getCredentials } from '@/features/integrations/services/threecplus.service';

interface ThreeCPlusClientToken {
  token: string;
  domain: string;
  login: string;
}

/**
 * Returns decrypted 3CPlus credentials for client-side Socket.io and WebRTC iframe.
 * RLS ensures only the owning user can trigger this action.
 */
export async function getThreeCPlusClientToken(): Promise<ActionResult<ThreeCPlusClientToken>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { userId } = auth.data;

  const creds = await getCredentials(userId);
  if (!creds) {
    return { success: false, error: '3CPlus não configurado para este usuário' };
  }

  return {
    success: true,
    data: {
      token: creds.apiToken,
      domain: creds.domain,
      login: creds.login,
    },
  };
}
