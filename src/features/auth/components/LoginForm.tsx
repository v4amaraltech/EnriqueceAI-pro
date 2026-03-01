'use client';

import { useActionState, useEffect, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { signIn } from '../actions/sign-in';

const HASH_ERROR_MESSAGES: Record<string, string> = {
  otp_expired: 'O link expirou. Faça login com seu email e senha.',
  access_denied: 'Acesso negado. Faça login com seu email e senha.',
};

export function LoginForm({ error: initialError }: { error?: string }) {
  const router = useRouter();
  const [hashError, setHashError] = useState<string | undefined>();

  // Extract error from hash fragments (Supabase redirects with #error=...)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('error')) return;

    const params = new URLSearchParams(hash.replace('#', ''));
    const errorCode = params.get('error_code') || params.get('error');

    if (errorCode && HASH_ERROR_MESSAGES[errorCode]) {
      setHashError(HASH_ERROR_MESSAGES[errorCode]);
    } else if (errorCode) {
      setHashError('Erro na autenticação. Faça login com seu email e senha.');
    }

    // Clean the hash from URL
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string }, formData: FormData) => {
      const result = await signIn(formData);
      if (result.success) {
        router.push('/dashboard');
        return {};
      }
      return { error: result.error };
    },
    { error: initialError },
  );

  const displayError = state.error || hashError;

  return (
    <div className="mx-auto w-full max-w-sm space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-bold">Entrar</h1>
        <p className="text-muted-foreground">Acesse sua conta</p>
      </div>

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="seu@email.com" required />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Senha</Label>
            <Link href="/forgot-password" className="text-xs text-primary hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <Input id="password" name="password" type="password" required />
        </div>

        {displayError && <p className="text-sm text-destructive">{displayError}</p>}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Entrando...' : 'Entrar'}
        </Button>
      </form>

    </div>
  );
}
