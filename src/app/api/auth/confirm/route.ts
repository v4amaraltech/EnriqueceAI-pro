import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getAppUrl } from '@/lib/utils/app-url';

import { acceptPendingInvite } from '@/features/auth/actions/accept-invite';

/**
 * General auth callback for all Supabase auth flows (PKCE).
 *
 * Handles: invite acceptance, password recovery, magic links.
 * Supabase redirects here with a `code` query param to exchange for a session.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const type = searchParams.get('type'); // 'recovery' for password reset

    if (!code) {
      return NextResponse.redirect(new URL('/login?error=missing_code', getAppUrl()));
    }

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      return NextResponse.redirect(new URL('/login?error=auth', getAppUrl()));
    }

    // Password recovery flow → redirect to set new password
    if (type === 'recovery') {
      return NextResponse.redirect(new URL('/setup-password', getAppUrl()));
    }

    // Accept pending org invite if one exists (deletes auto-created org, activates member)
    const inviteResult = await acceptPendingInvite().catch((err) => {
      console.error('Failed to accept pending invite on callback:', err);
      return null;
    });

    // Invite accepted → redirect to set up password
    if (inviteResult && inviteResult.success && inviteResult.data) {
      return NextResponse.redirect(new URL('/setup-password', getAppUrl()));
    }

    return NextResponse.redirect(new URL('/dashboard', getAppUrl()));
  } catch (err) {
    console.error('[auth/confirm] Unexpected error:', err);
    return NextResponse.redirect(new URL('/login?error=auth', getAppUrl()));
  }
}
