'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import type { SubscriptionStatus } from '../types';

const ALLOWED_BLOCKED_PATHS = ['/upgrade', '/settings/billing'];

interface SubscriptionGuardProps {
  status: SubscriptionStatus;
  periodEnd?: string | null;
  children: React.ReactNode;
}

export function SubscriptionGuard({ status, periodEnd, children }: SubscriptionGuardProps) {
  const pathname = usePathname();
  const router = useRouter();

  const isBlocked =
    status === 'canceled' ||
    (status === 'trialing' && periodEnd && new Date(periodEnd) < new Date());

  useEffect(() => {
    if (isBlocked && !ALLOWED_BLOCKED_PATHS.some((p) => pathname.startsWith(p))) {
      router.replace('/upgrade');
    }
  }, [isBlocked, pathname, router]);

  return <>{children}</>;
}
