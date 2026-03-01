'use server';

import { headers } from 'next/headers';

import type { ActionResult } from '@/lib/actions/action-result';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { forgotPasswordSchema } from '../schemas/auth.schemas';

// 3 reset attempts per 15 minutes per IP
const RESET_LIMIT = 3;
const RESET_WINDOW_MS = 15 * 60 * 1000;

export async function resetPassword(formData: FormData): Promise<ActionResult<void>> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rateCheck = checkRateLimit(`reset:${ip}`, RESET_LIMIT, RESET_WINDOW_MS);
  if (!rateCheck.allowed) {
    const retryMinutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000);
    return {
      success: false,
      error: `Muitas tentativas. Tente novamente em ${retryMinutes} minuto(s).`,
      code: 'RATE_LIMITED',
    };
  }

  const raw = { email: formData.get('email') };

  const parsed = forgotPasswordSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const supabase = await createServerSupabaseClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${appUrl}/api/auth/confirm?type=recovery`,
  });

  if (error) {
    return { success: false, error: error.message, code: error.code };
  }

  return { success: true, data: undefined };
}
