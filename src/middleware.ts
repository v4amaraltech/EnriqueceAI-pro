import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

import { getAppUrl } from '@/lib/utils/app-url';

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/setup-password', '/demo'];
const PUBLIC_PREFIXES = ['/feedback/', '/CL0/'];
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];
const API_PUBLIC_PREFIXES = ['/api/webhooks', '/api/track', '/api/auth/callback', '/api/auth/confirm', '/api/v1', '/api/feedback', '/api/admin', '/api/workers'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public API routes (webhooks, tracking, auth callbacks) — no session needed
  if (API_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // CSRF origin check for non-GET requests (defense-in-depth).
  // Also accept the request's own host (covers Vercel preview deployments
  // during DNS outages: app.enriqueceai.com.br was unreachable on 2026-05-19,
  // team logged in via the *.vercel.app preview URL — same deploy, same
  // origin POSTing to itself, just a different hostname).
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin) {
      const allowedOrigin = new URL(getAppUrl()).origin;
      const requestOrigin = `${request.nextUrl.protocol}//${request.nextUrl.host}`;
      const isVercelPreview = /^https:\/\/enriqueceai-[a-z0-9]+-v4company-amaral\.vercel\.app$/.test(origin);
      if (origin !== allowedOrigin && origin !== requestOrigin && !isVercelPreview) {
        return NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 });
      }
    }
  }

  // Cron endpoints use Bearer auth, not session — skip session handling.
  // /api/crm/sync has dual auth (cron-secret for batch, user session for manual);
  // its route handler picks the right path, the middleware just lets it through.
  if (pathname.startsWith('/api/cron/') || pathname === '/api/crm/sync') {
    return NextResponse.next();
  }

  // Create supabase client with cookie handling
  let response = NextResponse.next({ request });

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
          response = NextResponse.next({ request });
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
