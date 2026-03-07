'use client';

import { useState } from 'react';

import Link from 'next/link';
import { Clock } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

interface TrialBannerProps {
  periodEnd: string;
}

function calcDaysRemaining(periodEnd: string): number {
  return Math.max(
    0,
    Math.ceil((new Date(periodEnd).getTime() - Date.now()) / (1000 * 60 * 60 * 24)),
  );
}

export function TrialBanner({ periodEnd }: TrialBannerProps) {
  const [daysRemaining] = useState(() => calcDaysRemaining(periodEnd));

  return (
    <div className="flex items-center justify-center gap-3 border-b border-yellow-300/30 bg-yellow-50 px-4 py-2 text-sm text-yellow-800 dark:border-yellow-700/30 dark:bg-yellow-900/20 dark:text-yellow-200">
      <Clock className="h-4 w-4 flex-shrink-0" />
      <span>
        Trial: <strong>{daysRemaining} {daysRemaining === 1 ? 'dia restante' : 'dias restantes'}</strong>
      </span>
      <Link href="/upgrade">
        <Button size="sm" variant="outline" className="h-7 border-yellow-400 text-yellow-800 hover:bg-yellow-100 dark:border-yellow-600 dark:text-yellow-200 dark:hover:bg-yellow-900/40">
          Fazer upgrade
        </Button>
      </Link>
    </div>
  );
}
