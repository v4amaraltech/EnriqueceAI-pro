import { NextResponse } from 'next/server';

import { handleCrmCallback } from '@/features/integrations/actions/manage-crm';

/**
 * Pipedrive forces private apps to use /API/v2/callback as the callback URL.
 * This route handles the Pipedrive OAuth callback at that path.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

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
