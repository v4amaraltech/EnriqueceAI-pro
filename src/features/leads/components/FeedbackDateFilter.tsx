'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';

export function FeedbackDateFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (fromParam && toParam) {
      return { from: new Date(fromParam), to: new Date(toParam) };
    }
    return undefined;
  });

  function applyFilter(range: DateRange | undefined) {
    setDateRange(range);
    const params = new URLSearchParams(searchParams.toString());
    if (range?.from && range?.to) {
      params.set('from', format(range.from, 'yyyy-MM-dd'));
      params.set('to', format(range.to, 'yyyy-MM-dd'));
    } else {
      params.delete('from');
      params.delete('to');
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn('justify-start text-left text-xs font-normal', !dateRange && 'text-muted-foreground')}
          >
            <CalendarIcon className="mr-2 h-3.5 w-3.5" />
            {dateRange?.from ? (
              dateRange.to ? (
                <>
                  {format(dateRange.from, 'dd MMM', { locale: ptBR })} –{' '}
                  {format(dateRange.to, 'dd MMM yyyy', { locale: ptBR })}
                </>
              ) : (
                format(dateRange.from, 'dd MMM yyyy', { locale: ptBR })
              )
            ) : (
              'Filtrar por período'
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            defaultMonth={dateRange?.from}
            selected={dateRange}
            onSelect={(range) => applyFilter(range)}
            numberOfMonths={2}
            locale={ptBR}
          />
        </PopoverContent>
      </Popover>
      {dateRange && (
        <Button variant="ghost" size="sm" className="text-xs" onClick={() => applyFilter(undefined)}>
          Limpar
        </Button>
      )}
    </div>
  );
}
