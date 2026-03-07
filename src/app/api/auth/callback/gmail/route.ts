import { NextResponse } from 'next/server';

import { handleGmailCallback } from '@/features/integrations/actions/manage-gmail';

// Only allow relative paths starting with /
function sanitizeRedirect(state: string | null): string {
  if (!state || !state.startsWith('/') || state.includes('://')) {
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
      new URL(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=oauth_denied`, url.origin),
    );
  }

  if (!code) {
    return NextResponse.redirect(
      new URL(`${redirectTarget}${redirectTarget.includes('?') ? '&' : '?'}error=no_code`, url.origin),
    );
  }

  const result = await handleGmailCallback(code);

  if (result.success) {
    return NextResponse.redirect(new URL(redirectTarget, url.origin));
  }

  return NextResponse.redirect(
    new URL(`/settings/integrations?error=${encodeURIComponent(result.error)}`, url.origin),
  );
}
