'use client';

import { useCallback, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { format } from 'date-fns';

import { cn } from '@/lib/utils';
import { DateRangePicker } from '@/shared/components/DateRangePicker';

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
  const defaultTo = format(new Date(), 'yyyy-MM-dd');
  const defaultFrom = format(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd');
  const dateFrom = searchParams.get('from') ?? defaultFrom;
  const dateTo = searchParams.get('to') ?? defaultTo;

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

  const handleDateChange = useCallback(
    (from: string, to: string) => {
      updateParams({ from, to });
    },
    [updateParams],
  );

  return (
    <div className={cn('space-y-5', isPending && 'opacity-70')}>
      {/* FILTROS header */}
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Filtros
      </h3>

      {/* Date Range Picker */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Período
        </label>
        <DateRangePicker
          from={dateFrom}
          to={dateTo}
          onChange={handleDateChange}
        />
      </div>

      {/* Cadence Filter */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
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
        <label className="text-xs font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
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
              {m.name ?? m.email.split('@')[0]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
