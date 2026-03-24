'use server';

import { headers } from 'next/headers';

import type { ActionResult } from '@/lib/actions/action-result';
import { ERR_RATE_LIMITED } from '@/lib/constants/error-codes';
import { LOGIN_LIMIT, LOGIN_WINDOW_MS } from '@/lib/constants/limits';
import { checkRateLimit, resetRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { signInSchema } from '../schemas/auth.schemas';

export async function signIn(formData: FormData): Promise<ActionResult<void>> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const rateLimitKey = `login:${ip}`;

  const rateCheck = await checkRateLimit(rateLimitKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rateCheck.allowed) {
    const retryMinutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000);
    return {
      success: false,
      error: `Muitas tentativas de login. Tente novamente em ${retryMinutes} minuto(s).`,
      code: ERR_RATE_LIMITED,
    };
  }

  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  // Reset rate limit on successful login
  await resetRateLimit(rateLimitKey);

  return { success: true, data: undefined };
}
