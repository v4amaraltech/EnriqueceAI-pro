import { NextResponse } from 'next/server';

import { getAppUrl } from '@/lib/utils/app-url';

// Corporate inboxes rewrite outbound links into `/CL0/<encoded-url>/<id>/<hash>`
// (SendGrid/MailGun-style click tracking). This hits feedback links and also
// Supabase auth emails (password reset, invites). Decode the wrapped URL,
// sanity-check the host, and redirect to the intended destination.

const ALLOWED_HOSTS = new Set([
  'app.enriqueceai.com.br',
  'enriqueceai.com.br',
]);

function isAllowedRedirectHost(host: string): boolean {
  return ALLOWED_HOSTS.has(host) || host.endsWith('.supabase.co');
}

function safeFallback(): NextResponse {
  // Never use request.url origin behind Coolify/proxies — it can be 0.0.0.0:80.
  return NextResponse.redirect(new URL('/', getAppUrl()), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const trailing = url.pathname.replace(/^\/CL0\//i, '');
  if (!trailing) return safeFallback();

  const encoded = trailing.split('/')[0];
  if (!encoded) return safeFallback();

  let target: URL;
  try {
    target = new URL(decodeURIComponent(encoded));
  } catch {
    return safeFallback();
  }

  if (!isAllowedRedirectHost(target.host)) return safeFallback();

  return NextResponse.redirect(target.toString(), 302);
}

export const HEAD = GET;
