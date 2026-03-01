import { NextResponse, type NextRequest } from 'next/server';

import { createServerSupabaseClient } from '@/lib/supabase/server';

import { acceptPendingInvite } from '@/features/auth/actions/accept-invite';

/**
 * General auth callback for all Supabase auth flows (PKCE).
 *
 * Handles: invite acceptance, password recovery, magic links.
 * Supabase redirects here with a `code` query param to exchange for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type'); // 'recovery' for password reset

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(new URL('/login?error=auth', request.url));
  }

  // Password recovery flow → redirect to set new password
  if (type === 'recovery') {
    return NextResponse.redirect(new URL('/setup-password', request.url));
  }

  // Accept pending org invite if one exists (deletes auto-created org, activates member)
  const inviteResult = await acceptPendingInvite().catch((err) => {
    console.error('Failed to accept pending invite on callback:', err);
    return null;
  });

  // Invite accepted → redirect to set up password
  if (inviteResult && inviteResult.success && inviteResult.data) {
    return NextResponse.redirect(new URL('/setup-password', request.url));
  }

  return NextResponse.redirect(new URL('/dashboard', request.url));
}
