import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import { LoginForm } from '@/features/auth/components/LoginForm';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect('/dashboard');

  const { error } = await searchParams;

  const errorMessages: Record<string, string> = {
    auth: 'Falha na autenticação. Tente novamente.',
    otp_expired: 'O link expirou. Faça login com seu email e senha.',
    access_denied: 'Acesso negado. Faça login com seu email e senha.',
    missing_code: 'Link inválido. Faça login com seu email e senha.',
  };

  const errorMessage = error ? (errorMessages[error] ?? 'Erro na autenticação. Tente novamente.') : undefined;

  return <LoginForm error={errorMessage} />;
}
