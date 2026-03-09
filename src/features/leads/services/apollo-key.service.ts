import { decrypt } from '@/lib/security/encryption';
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
