import { NextResponse } from 'next/server';

import { handleCrmCallback } from '@/features/integrations/actions/manage-crm';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Kommo sends the account subdomain as "referer" (single 'r')
  // Some Kommo versions may use different param names
  const referer = url.searchParams.get('referer')
    ?? url.searchParams.get('account_subdomain')
    ?? url.searchParams.get('subdomain');

  if (error) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_denied', url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=no_code', url.origin),
    );
  }

  if (!referer) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=kommo_missing_subdomain', url.origin),
    );
  }

  const result = await handleCrmCallback('kommo', code, referer);

  if (result.success) {
    return NextResponse.redirect(
      new URL('/settings/integrations?success=kommo_connected', url.origin),
    );
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, url.origin),
  );
}
