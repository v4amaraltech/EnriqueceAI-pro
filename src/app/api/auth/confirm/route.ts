import { type EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/utils/app-url';

import { acceptPendingInvite } from '@/features/auth/actions/accept-invite';

/**
 * General auth callback for all Supabase auth flows (PKCE + email OTP).
 *
 * Handles: invite acceptance, password recovery, magic links.
 * Supports both:
 * - `?code=` from PKCE (resetPasswordForEmail redirectTo flow)
 * - `?token_hash=&type=` from email templates (recommended behind corporate link scanners)
 */
function redirectTo(path: string): NextResponse {
  return NextResponse.redirect(new URL(path, getAppUrl()));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const token_hash = searchParams.get('token_hash');
    const type = searchParams.get('type') as EmailOtpType | null;

    const authError = searchParams.get('error_code') ?? searchParams.get('error');
    if (authError) {
      return redirectTo(`/login?error=${encodeURIComponent(authError)}`);
    }

    const supabase = await createServerSupabaseClient();

    if (token_hash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash });
      if (error) {
        console.error('[auth/confirm] verifyOtp failed:', error.message);
        const codeParam =
          error.message.toLowerCase().includes('expired') ||
          error.message.toLowerCase().includes('invalid')
            ? 'otp_expired'
            : 'auth';
        return redirectTo(`/login?error=${codeParam}`);
      }
    } else if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('[auth/confirm] exchangeCodeForSession failed:', error.message);
        const codeParam =
          error.message.toLowerCase().includes('expired') ||
          error.message.toLowerCase().includes('invalid')
            ? 'otp_expired'
            : 'auth';
        return redirectTo(`/login?error=${codeParam}`);
      }
    } else {
      return redirectTo('/login?error=missing_code');
    }

    if (type === 'recovery') {
      return redirectTo('/setup-password');
    }

    const inviteResult = await acceptPendingInvite().catch((err) => {
      console.error('Failed to accept pending invite on callback:', err);
      return null;
    });

    if (inviteResult && inviteResult.success && inviteResult.data) {
      return redirectTo('/setup-password');
    }

    return redirectTo('/dashboard');
  } catch (err) {
    console.error('[auth/confirm] Unexpected error:', err);
    return redirectTo('/login?error=auth');
  }
}
