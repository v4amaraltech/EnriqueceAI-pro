'use server';

import { headers } from 'next/headers';

import type { ActionResult } from '@/lib/actions/action-result';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { signUpSchema } from '../schemas/auth.schemas';

// 3 signup attempts per 15 minutes per IP
const SIGNUP_LIMIT = 3;
const SIGNUP_WINDOW_MS = 15 * 60 * 1000;

export async function signUp(formData: FormData): Promise<ActionResult<{ userId: string }>> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rateCheck = await checkRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!rateCheck.allowed) {
    const retryMinutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000);
    return {
      success: false,
      error: `Muitas tentativas de cadastro. Tente novamente em ${retryMinutes} minuto(s).`,
      code: 'RATE_LIMITED',
    };
  }

  const raw = {
    name: formData.get('name'),
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.name },
    },
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: { userId: data.user?.id ?? '' } };
}
