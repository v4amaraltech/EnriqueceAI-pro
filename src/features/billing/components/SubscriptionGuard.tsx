'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { SubscriptionStatus } from '../types';

const ALLOWED_CANCELED_PATHS = ['/upgrade', '/settings/billing'];

interface SubscriptionGuardProps {
  status: SubscriptionStatus;
  children: React.ReactNode;
}

export function SubscriptionGuard({ status, children }: SubscriptionGuardProps) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (
      status === 'canceled' &&
      !ALLOWED_CANCELED_PATHS.some((p) => pathname.startsWith(p))
    ) {
      router.replace('/upgrade');
    }
  }, [status, pathname, router]);

  return <>{children}</>;
}
