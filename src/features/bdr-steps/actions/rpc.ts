import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Chamada de RPC sem depender dos tipos gerados (types.ts é regenerado só
 * depois de a migração ir para o projeto). Mesmo padrão da rota de holds.
 */
export async function callRpc<T>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (
    f: string,
    a: Record<string, unknown>,
  ) => Promise<{ data: T | null; error: { message: string } | null }>)(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
