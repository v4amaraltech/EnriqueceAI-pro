import { decrypt } from '@/lib/security/encryption';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Fetches and decrypts the Apollo API key for a given organization.
 * Returns null if no connection exists.
 */
export async function getApolloApiKey(orgId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();

  const { data } = (await (supabase
    .from('apollo_connections' as never) as ReturnType<typeof supabase.from>)
    .select('api_key_encrypted')
    .eq('org_id', orgId)
    .maybeSingle()) as { data: { api_key_encrypted: string } | null };

  if (!data?.api_key_encrypted) return null;

  return decrypt(data.api_key_encrypted);
}
