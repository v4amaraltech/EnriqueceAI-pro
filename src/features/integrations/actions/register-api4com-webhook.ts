'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { getAppUrl } from '@/lib/utils/app-url';

import { registerWebhook } from '../services/api4com.service';

/**
 * Register a webhook on API4COM so we receive channel-hangup events.
 * Called automatically after saving API4COM config.
 */
export async function registerApi4ComWebhook(): Promise<ActionResult<void>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.data;

  const appUrl = getAppUrl();
  const webhookSecret = process.env.API4COM_WEBHOOK_SECRET;
  const webhookUrl = webhookSecret
    ? `${appUrl}/api/webhooks/api4com?token=${webhookSecret}`
    : `${appUrl}/api/webhooks/api4com`;
  const gateway = `flux-${orgId}`;

  try {
    await registerWebhook(userId, webhookUrl, gateway);
    return { success: true, data: undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro ao registrar webhook';
    console.error('[api4com] registerWebhook failed:', message);
    return { success: false, error: message };
  }
}
