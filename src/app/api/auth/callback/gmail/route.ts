import { NextResponse } from 'next/server';

import { handleGmailCallback } from '@/features/integrations/actions/manage-gmail';
import { consumeOAuthState } from '@/lib/security/oauth-state';
import { sanitizeRedirect } from '@/lib/security/safe-redirect';
import { getAppUrl } from '@/lib/utils/app-url';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // State packs "<csrf>|<redirect>" (issued in getGmailAuthUrl). Split first,
  // validate the CSRF half against the HttpOnly cookie, then trust the redirect.
  const rawState = url.searchParams.get('state');
  const sepIdx = rawState?.indexOf('|') ?? -1;
  const csrfPart = sepIdx >= 0 ? rawState!.slice(0, sepIdx) : rawState;
  const redirectPart = sepIdx >= 0 ? rawState!.slice(sepIdx + 1) : null;
  const redirectTarget = sanitizeRedirect(redirectPart);

  if (error) {
    return NextResponse.redirect(
      new URL(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=oauth_denied`, getAppUrl()),
    );
  }

  const stateValid = await consumeOAuthState('google', csrfPart);
  if (!stateValid) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_state_mismatch', getAppUrl()),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=no_code`, getAppUrl()),
    );
  }

  const result = await handleGmailCallback(code);

  if (result.success) {
    return NextResponse.redirect(new URL(redirectTarget, getAppUrl()));
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, getAppUrl()),
  );
}
