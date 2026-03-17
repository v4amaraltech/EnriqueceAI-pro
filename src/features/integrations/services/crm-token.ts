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
  let credentials = decryptJson<CrmCredentials>(connection.credentials_encrypted);

  if (
    credentials.token_expires_at &&
    new Date(credentials.token_expires_at) <= new Date()
  ) {
    credentials = await adapter.refreshToken(credentials);
    await from(supabase, 'crm_connections')
      .update({ credentials_encrypted: encryptJson(credentials) } as Record<string, unknown>)
      .eq('id', connection.id);
  }

  return credentials;
}
