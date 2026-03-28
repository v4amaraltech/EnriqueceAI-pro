import crypto from 'crypto';

import { decrypt } from '@/lib/security/encryption';
import { getEnv } from '@/config/env';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { from } from '@/lib/supabase/from';

/**
 * Fetches and decrypts the Apollo API key for a given organization.
 * Returns null if no connection exists.
 */
export async function getApolloApiKey(orgId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();

  const { data } = (await from(supabase, 'apollo_connections')
    .select('api_key_encrypted')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { api_key_encrypted: string } | null };

  if (!data?.api_key_encrypted) return null;

  return decrypt(data.api_key_encrypted);
}

/**
 * Builds the Apollo webhook URL with HMAC-bound org_id.
 * Token = HMAC-SHA256(APOLLO_WEBHOOK_SECRET, orgId) — prevents org spoofing.
 * Returns null if APOLLO_WEBHOOK_SECRET is not configured.
 */
export function buildApolloWebhookUrl(orgId: string): string | null {
  const secret = process.env.APOLLO_WEBHOOK_SECRET?.trim();
  if (!secret) return null;
  const appUrl = getEnv().NEXT_PUBLIC_APP_URL;
  const token = crypto.createHmac('sha256', secret).update(orgId).digest('hex');
  return `${appUrl}/api/webhooks/apollo?org_id=${encodeURIComponent(orgId)}&token=${encodeURIComponent(token)}`;
}
