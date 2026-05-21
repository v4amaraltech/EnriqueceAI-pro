import { NextResponse } from 'next/server';

// Closers' inboxes rewrite our feedback links into the `/CL0/<encoded-url>/<id>/<hash>`
// shape (SendGrid/MailGun-style click tracking). Without this handler the path
// 404s and the middleware bounces the closer to /login — they think the
// feedback form is gated. Decode the wrapped URL, sanity-check the host, and
// redirect back to the intended destination.

const ALLOWED_HOSTS = new Set([
  'app.enriqueceai.com.br',
  'enriqueceai.com.br',
]);

function safeFallback(origin: string): NextResponse {
  return NextResponse.redirect(new URL('/', origin), 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const trailing = url.pathname.replace(/^\/CL0\//i, '');
  if (!trailing) return safeFallback(url.origin);

  const encoded = trailing.split('/')[0];
  if (!encoded) return safeFallback(url.origin);

  let target: URL;
  try {
    target = new URL(decodeURIComponent(encoded));
  } catch {
    return safeFallback(url.origin);
  }

  if (!ALLOWED_HOSTS.has(target.host)) return safeFallback(url.origin);

  return NextResponse.redirect(target.toString(), 302);
}

export const HEAD = GET;
