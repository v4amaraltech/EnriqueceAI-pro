import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

import { getAppUrl } from '@/lib/utils/app-url';

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/setup-password', '/demo', '/demo/call-workspace'];
const PUBLIC_PREFIXES = ['/feedback/', '/CL0/', '/docs/', '/unsubscribe/'];
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];
// Privileged prefixes are default-DENY: the middleware requires a valid
// service-role or cron-secret Bearer before the request reaches the handler
// (belt-and-suspenders over each route's own verifyServiceRole/verifyCronSecret,
// so a new route that forgets the guard is not silently exposed).
const PRIVILEGED_API_PREFIXES = ['/api/admin', '/api/workers'];
const API_PUBLIC_PREFIXES = ['/api/health', '/api/version', '/api/webhooks', '/api/track', '/api/auth/callback', '/api/auth/confirm', '/api/v1', '/api/feedback', '/api/unsubscribe'];

/** Constant-time string compare (Edge-safe, no node:crypto). */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True when the request carries a valid service-role or cron-secret Bearer. */
function hasPrivilegedBearer(request: NextRequest): boolean {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (serviceKey && safeEqual(token, serviceKey)) return true;
  // CRON_SECRET may hold a comma-separated list (rotation).
  const cronTokens = (process.env.CRON_SECRET ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  return cronTokens.some((t) => safeEqual(token, t));
}

/**
 * Same-origin check for state-changing requests. Prefers Origin and falls back
 * to Referer; a request carrying neither an allowed Origin nor an allowed
 * Referer is rejected (hardened — the old check skipped entirely when Origin
 * was absent). Only reaches cookie-based app routes; Bearer/webhook routes are
 * handled earlier.
 */
function isSameOriginRequest(request: NextRequest): boolean {
  const allowedOrigin = new URL(getAppUrl()).origin;
  const requestOrigin = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const isAllowed = (value: string | null): boolean => {
    if (!value) return false;
    let candidate: string;
    try {
      candidate = new URL(value).origin;
    } catch {
      return false;
    }
    const isVercelPreview = /^https:\/\/enriqueceai-[a-z0-9]+-v4company-amaral\.vercel\.app$/.test(candidate);
    return candidate === allowedOrigin || candidate === requestOrigin || isVercelPreview;
  };
  const origin = request.headers.get('origin');
  return origin ? isAllowed(origin) : isAllowed(request.headers.get('referer'));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Default-DENY gate for privileged API prefixes (/api/admin, /api/workers):
  // require a valid service-role or cron-secret Bearer at the edge. Bearer/
  // cookieless, so no session or CSRF applies past this point.
  if (PRIVILEGED_API_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    if (!hasPrivilegedBearer(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Bearer-authenticated, cookieless endpoints (cron + cron/manual crm sync):
  // skip session AND the CSRF check below (CSRF targets cookie auth; these send
  // no Origin). Must come BEFORE the CSRF check so a legit cron POST isn't
  // rejected for lacking an Origin.
  if (pathname.startsWith('/api/cron/') || pathname === '/api/crm/sync') {
    return NextResponse.next();
  }

  // Other public API routes (webhooks, tracking, auth callbacks, v1, feedback) —
  // own auth (signatures/tokens), no session or CSRF.
  if (API_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // CSRF origin check for state-changing requests (defense-in-depth), hardened:
  // only cookie-based app routes (Server Actions/pages) reach here, and they must
  // carry an allowed Origin — or, if Origin is absent, an allowed Referer.
  // Also accepts the request's own host (covers Vercel preview deployments during
  // DNS outages: app.enriqueceai.com.br was unreachable on 2026-05-19 and the
  // team logged in via the *.vercel.app preview — same deploy POSTing to itself).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 });
    }
  }

  // Expose the pathname to Server Components (a layout can't read it otherwise),
  // so the (app) layout's subscription gate can exempt /upgrade and
  // /settings/billing without an infinite redirect loop.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-pathname', pathname);

  // Create supabase client with cookie handling
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refresh session — this keeps the auth token alive
  const { data: { user } } = await supabase.auth.getUser();

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);
  const isOnboarding = pathname === '/onboarding';

  const isPublicPrefix = PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  // Not authenticated → redirect to login (unless already on public route)
  if (!user && !isPublicRoute && !isPublicPrefix && !isOnboarding) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Not authenticated on onboarding → redirect to login
  if (!user && isOnboarding) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Authenticated → redirect away from auth pages to dashboard
  if (user && AUTH_ROUTES.includes(pathname)) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  // Authenticated on root → redirect to dashboard
  if (user && pathname === '/') {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
