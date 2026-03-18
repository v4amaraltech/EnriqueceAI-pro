import { decryptJson, encryptJson } from '@/lib/security/encryption';
import { from } from '@/lib/supabase/from';

import type { CrmConnectionRow, CrmCredentials } from '../types/crm';

type SupabaseClient = Parameters<typeof from>[0];

/**
 * Decrypts credentials and refreshes the OAuth token if expired.
 * Persists refreshed credentials back to the database.
 */
export async function ensureFreshCredentials(
  connection: CrmConnectionRow,
  adapter: { refreshToken(credentials: CrmCredentials): Promise<CrmCredentials> },
  supabase: SupabaseClient,
): Promise<CrmCredentials> {
  const credentials = decryptJson<CrmCredentials>(connection.credentials_encrypted);

  // RD Station CRM uses a non-expiring API token — skip refresh
  if (connection.crm_provider === 'rdstation') {
    return credentials;
  }

  if (
    credentials.token_expires_at &&
    new Date(credentials.token_expires_at) <= new Date()
  ) {
    const refreshed = await adapter.refreshToken(credentials);
    await from(supabase, 'crm_connections')
      .update({ credentials_encrypted: encryptJson(refreshed) } as Record<string, unknown>)
      .eq('id', connection.id);
    return refreshed;
  }

  return credentials;
}
