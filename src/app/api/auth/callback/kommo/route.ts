import { NextResponse } from 'next/server';

import { handleCrmCallback } from '@/features/integrations/actions/manage-crm';
import { consumeOAuthState } from '@/lib/security/oauth-state';
import { getAppUrl } from '@/lib/utils/app-url';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  // Kommo sends the account subdomain as "referer" (single 'r')
  // Some Kommo versions may use different param names
  const referer = url.searchParams.get('referer')
    ?? url.searchParams.get('account_subdomain')
    ?? url.searchParams.get('subdomain');

  if (error) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_denied', getAppUrl()),
    );
  }

  // Validate state cookie against the value the provider echoed back. Issued
  // by getCrmAuthUrl when the manager kicked off the OAuth flow. Kommo
  // Marketplace requires this CSRF defense.
  const stateValid = await consumeOAuthState('kommo', state);
  if (!stateValid) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_state_mismatch', getAppUrl()),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=no_code', getAppUrl()),
    );
  }

  if (!referer) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=kommo_missing_subdomain', getAppUrl()),
    );
  }

  const result = await handleCrmCallback('kommo', code, referer);

  if (result.success) {
    return NextResponse.redirect(
      new URL('/settings/integrations?success=kommo_connected', getAppUrl()),
    );
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, getAppUrl()),
  );
}
