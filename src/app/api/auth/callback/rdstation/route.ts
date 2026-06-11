import { NextResponse } from 'next/server';

import { handleCrmCallback } from '@/features/integrations/actions/manage-crm';
import { getAppUrl } from '@/lib/utils/app-url';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=oauth_denied', getAppUrl()),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL('/settings/integrations?error=no_code', getAppUrl()),
    );
  }

  const result = await handleCrmCallback('rdstation', code);

  if (result.success) {
    return NextResponse.redirect(
      new URL('/settings/integrations?success=rdstation_connected', getAppUrl()),
    );
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, getAppUrl()),
  );
}
