import { type NextRequest, NextResponse } from 'next/server';

import { createServerClient } from '@supabase/ssr';

const PUBLIC_ROUTES = ['/login', '/signup', '/forgot-password', '/setup-password'];
const AUTH_ROUTES = ['/login', '/signup', '/forgot-password'];
const API_PUBLIC_PREFIXES = ['/api/webhooks', '/api/track', '/api/auth/callback', '/api/auth/confirm'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public API routes and other API routes
  if (API_PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // CSRF origin check for non-GET requests (defense-in-depth)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      const allowedOrigin = new URL(appUrl).origin;
      if (origin !== allowedOrigin) {
        return NextResponse.json({ error: 'CSRF origin mismatch' }, { status: 403 });
      }
    }
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

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname) || pathname === '/';
  const isOnboarding = pathname === '/onboarding';

  // Not authenticated → redirect to login (unless already on public route)
  if (!user && !isPublicRoute && !isOnboarding) {
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

  // Authenticated, not on onboarding, not on API → check if needs onboarding
  if (user && !isOnboarding && !pathname.startsWith('/api/')) {
    const { data: member } = await supabase
      .from('organization_members')
      .select('organization:organizations(name)')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .single();

    const orgName = (member as { organization?: { name?: string } } | null)?.organization?.name;
    if (orgName && /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(orgName)) {
      return NextResponse.redirect(new URL('/onboarding', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    // Match all routes except static files and Next.js internals
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
