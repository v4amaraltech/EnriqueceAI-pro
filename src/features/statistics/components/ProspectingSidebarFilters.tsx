'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CalendarIcon } from 'lucide-react';
import type { DateRange } from 'react-day-picker';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/components/ui/popover';

import type { OrgMember } from '../types/shared';

interface CadenceOption {
  id: string;
  name: string;
}

interface ProspectingSidebarFiltersProps {
  members: OrgMember[];
  cadences: CadenceOption[];
}

export function ProspectingSidebarFilters({
  members,
  cadences,
}: ProspectingSidebarFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Initialize date range from URL params or default to last 30 days
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');

  const [dateRange, setDateRange] = useState<DateRange | undefined>(() => {
    if (fromParam && toParam) {
      return { from: new Date(fromParam), to: new Date(toParam) };
    }
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from, to };
  });

  const currentUser = searchParams.get('user') ?? '';
  const currentCadence = searchParams.get('cadence') ?? '';

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (!value || value === '') {
          params.delete(key);
        } else {
          params.set(key, value);
        }
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${pathname}?${qs}` : pathname);
      });
    },
    [router, pathname, searchParams, startTransition],
  );

  // Sync date range to URL params when it changes
  useEffect(() => {
    if (!dateRange?.from || !dateRange?.to) return;
    const from = format(dateRange.from, 'yyyy-MM-dd');
    const to = format(dateRange.to, 'yyyy-MM-dd');
    const currentFrom = searchParams.get('from');
    const currentTo = searchParams.get('to');
    if (from !== currentFrom || to !== currentTo) {
      updateParams({ from, to });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange]);

  return (
    <div className={cn('space-y-5', isPending && 'opacity-70')}>
      {/* FILTROS header */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
        Filtros
      </h3>

      {/* Date Range Picker */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">
          Período
        </label>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                'w-full justify-start text-left text-xs font-normal',
                !dateRange && 'text-muted-foreground',
              )}
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
                'Selecionar período'
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="range"
              defaultMonth={dateRange?.from}
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={2}
              locale={ptBR}
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Cadence Filter */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">
          Cadência
        </label>
        <select
          value={currentCadence}
          onChange={(e) => updateParams({ cadence: e.target.value || undefined })}
          className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
        >
          <option value="">Todas as cadências</option>
          {cadences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* User/SDR Filter */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)]">
          Vendedor
        </label>
        <select
          value={currentUser}
          onChange={(e) => updateParams({ user: e.target.value || undefined })}
          className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs"
        >
          <option value="">Todos os vendedores</option>
          {members.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.email.split('@')[0]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
