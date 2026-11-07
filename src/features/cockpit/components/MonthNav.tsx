'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';

import { formatMonthLabel, shiftMonth } from '../utils/month';

/** Navegação de mês por `?month=YYYY-MM` (não passa do mês atual). */
export function MonthNav({ month, maxMonth }: { month: string; maxMonth?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hrefFor = (m: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', m);
    params.delete('page');
    return `${pathname}?${params.toString()}`;
  };

  const next = shiftMonth(month, 1);
  const canGoNext = !maxMonth || next <= maxMonth;

  return (
    <div className="flex items-center gap-1 rounded-md border px-1">
      <Button asChild variant="ghost" size="icon" className="h-7 w-7">
        <Link href={hrefFor(shiftMonth(month, -1))} aria-label="Mês anterior">
          <ChevronLeft className="h-4 w-4" />
        </Link>
      </Button>
      <span className="min-w-[120px] text-center text-xs font-medium capitalize">{formatMonthLabel(month)}</span>
      {canGoNext ? (
        <Button asChild variant="ghost" size="icon" className="h-7 w-7">
          <Link href={hrefFor(next)} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled aria-label="Próximo mês">
          <ChevronRight className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
