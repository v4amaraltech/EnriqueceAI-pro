'use server';

import { headers } from 'next/headers';
import { after } from 'next/server';

import type { ActionResult } from '@/lib/actions/action-result';
import { ERR_RATE_LIMITED } from '@/lib/constants/error-codes';
import { LOGIN_LIMIT, LOGIN_WINDOW_MS } from '@/lib/constants/limits';
import { checkRateLimit, resetRateLimit } from '@/lib/security/rate-limit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import { signInSchema } from '../schemas/auth.schemas';
import { findPendingInviteByEmail } from '../services/pending-invite';
import { resendInviteByEmail } from './resend-invite-by-email';

/** Teto por IP (sem reset em sucesso): o IP vem de X-Forwarded-For e pode ser forjado. */
const LOGIN_IP_LIMIT = 30;
/** Teto por e-mail alvo: vale mesmo girando o IP (pista 31). */
const LOGIN_EMAIL_LIMIT = 10;

function rateLimited(retryAfterMs?: number): ActionResult<void> {
  const retryMinutes = Math.ceil((retryAfterMs ?? 0) / 60000);
  return {
    success: false,
    error: `Muitas tentativas de login. Tente novamente em ${retryMinutes} minuto(s).`,
    code: ERR_RATE_LIMITED,
  };
}

export async function signIn(formData: FormData): Promise<ActionResult<void>> {
  try {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipCheck = await checkRateLimit(`login-ip:${ip}`, LOGIN_IP_LIMIT, LOGIN_WINDOW_MS);
  if (!ipCheck.allowed) return rateLimited(ipCheck.retryAfterMs);

  const raw = {
    email: formData.get('email'),
    password: formData.get('password'),
  };

  const parsed = signInSchema.safeParse(raw);
  if (!parsed.success) {
    return { success: false, error: parsed.error.errors[0]?.message ?? 'Dados inválidos' };
  }

  const email = parsed.data.email.trim().toLowerCase();
  const pairKey = `login:${ip}:${email}`;
  const emailKey = `login-email:${email}`;

  const pairCheck = await checkRateLimit(pairKey, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!pairCheck.allowed) return rateLimited(pairCheck.retryAfterMs);
  const emailCheck = await checkRateLimit(emailKey, LOGIN_EMAIL_LIMIT, LOGIN_WINDOW_MS);
  if (!emailCheck.allowed) return rateLimited(emailCheck.retryAfterMs);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    // Resposta neutra (pista 32): conta convidada e e-mail inexistente devolvem o mesmo
    // erro. A orientação do convite vai por e-mail (reenvio), fora do caminho da resposta.
    after(async () => {
      try {
        if (await findPendingInviteByEmail(parsed.data.email)) {
          await resendInviteByEmail(parsed.data.email);
        }
      } catch (err) {
        console.error('[signIn] invite resend error:', err);
      }
    });

    return { success: false, error: error.message, code: error.code };
  }

  // Só zera os contadores do par IP+e-mail e do e-mail; o do IP não (pista 31).
  await resetRateLimit(pairKey);
  await resetRateLimit(emailKey);

  return { success: true, data: undefined };
  } catch (error) {
    console.error('[signIn] Unhandled error:', error);
    return { success: false, error: 'Erro ao fazer login. Tente novamente.' };
  }
}
