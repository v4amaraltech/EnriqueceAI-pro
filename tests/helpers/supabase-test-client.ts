import { type SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Clientes para os testes de integração (Supabase LOCAL — `supabase start`).
 *
 * Trava de segurança (story statistics-rpc-integration-tests): os testes de
 * integração criam e apagam usuários e dados. Eles só rodam quando
 * `SUPABASE_URL` aponta para 127.0.0.1/localhost E há uma chave de serviço de
 * verdade. Antes a trava olhava só o formato da chave — com a chave de PROD no
 * ambiente, o teste de RLS criaria/apagaria usuários em produção.
 */

/** Valor falso que `tests/setup.ts` injeta para os testes unitários. */
const DUMMY_SERVICE_ROLE_KEY = 'test-service-role-key';
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLocalSupabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Os testes de integração devem rodar? Só contra um Supabase local com chave real. */
export function shouldRunIntegration(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  return isLocalSupabaseUrl(env.SUPABASE_URL) && !!key && key !== DUMMY_SERVICE_ROLE_KEY;
}

function localUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!isLocalSupabaseUrl(url)) {
    throw new Error(
      `Testes de integração só rodam contra Supabase local — SUPABASE_URL="${url ?? ''}" recusado.`,
    );
  }
  return url!;
}

export function createAdminClient(): SupabaseClient {
  return createClient(localUrl(), process.env.SUPABASE_SERVICE_ROLE_KEY ?? '', {
    auth: { persistSession: false },
  });
}

export function createAnonClient(): SupabaseClient {
  return createClient(localUrl(), process.env.SUPABASE_ANON_KEY ?? '', {
    auth: { persistSession: false },
  });
}

export async function createAuthenticatedClient(
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to authenticate ${email}: ${error.message}`);
  return client;
}

export async function createTestUser(
  adminClient: SupabaseClient,
  email: string,
  password: string,
): Promise<string> {
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create user ${email}: ${error.message}`);
  return data.user.id;
}
