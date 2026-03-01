'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

/**
 * Detects Supabase auth error hash fragments (e.g. #error=access_denied&error_code=otp_expired)
 * and redirects to /login with the error as a query param.
 * This is needed because hash fragments are client-side only and never reach the server.
 */
export function AuthErrorRedirect() {
  const router = useRouter();

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash || !hash.includes('error=')) return;

    const params = new URLSearchParams(hash.replace('#', ''));
    const errorCode = params.get('error_code') || params.get('error');

    if (errorCode) {
      router.replace(`/login?error=${encodeURIComponent(errorCode)}`);
    }
  }, [router]);

  return null;
}
