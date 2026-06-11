import { NextResponse } from 'next/server';

import { handleGmailCallback } from '@/features/integrations/actions/manage-gmail';
import { getAppUrl } from '@/lib/utils/app-url';

// Only allow same-origin relative paths (block protocol-relative URLs like //evil.com)
function sanitizeRedirect(state: string | null): string {
  if (!state || !state.startsWith('/') || state.startsWith('//') || state.includes('://')) {
    return '/settings/integrations';
  }
  return state;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const redirectTarget = sanitizeRedirect(url.searchParams.get('state'));

  if (error) {
    return NextResponse.redirect(
      new URL(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=oauth_denied`, getAppUrl()),
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
