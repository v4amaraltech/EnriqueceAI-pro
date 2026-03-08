'use server';

import { headers } from 'next/headers';

import type { ActionResult } from '@/lib/actions/action-result';
import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

// 2 resend attempts per 5 minutes per IP
const RESEND_LIMIT = 2;
const RESEND_WINDOW_MS = 5 * 60 * 1000;

export async function resendVerification(email: string): Promise<ActionResult<null>> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  const rateCheck = await checkRateLimit(`resend:${ip}`, RESEND_LIMIT, RESEND_WINDOW_MS);
  if (!rateCheck.allowed) {
    const retryMinutes = Math.ceil((rateCheck.retryAfterMs ?? 0) / 60000);
    return {
      success: false,
      error: `Aguarde ${retryMinutes} minuto(s) antes de tentar novamente.`,
      code: 'RATE_LIMITED',
    };
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: null };
}
