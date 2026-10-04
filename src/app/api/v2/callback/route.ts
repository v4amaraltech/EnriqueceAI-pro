import { NextResponse } from 'next/server';

import { handleCrmCallback } from '@/features/integrations/actions/manage-crm';
import { consumeOAuthState } from '@/lib/security/oauth-state';

/**
 * Pipedrive forces private apps to use /API/v2/callback as the callback URL.
 * This route handles the Pipedrive OAuth callback at that path.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_denied', url.origin),
    );
  }

  // Validate the CSRF state cookie issued by getCrmAuthUrl before exchanging the
  // code — same guard as /api/auth/callback/pipedrive. This is the path Pipedrive
  // actually calls back (via the /API/v2/callback rewrite), so without it an
  // attacker could graft their own Pipedrive account onto a logged-in manager's org.
  const stateValid = await consumeOAuthState('pipedrive', state);
  if (!stateValid) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_state_mismatch', url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=no_code', url.origin),
    );
  }

  const result = await handleCrmCallback('pipedrive', code);

  if (result.success) {
    return NextResponse.redirect(
      new URL('/settings/integrations?success=pipedrive_connected', url.origin),
    );
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, url.origin),
  );
}
