'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import { useDateRange } from '@/shared/hooks/useDateRange';

import type { OrgMember } from '../types/shared';

interface StatisticsFiltersProps {
  basePath: string;
  members: OrgMember[];
  children?: React.ReactNode;
}

export function StatisticsFilters({
  basePath,
  members,
  children,
}: StatisticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { from, to, setRange, compare, setCompare } = useDateRange(basePath);

  const currentUser = searchParams.get('user') ?? '';

  const updateUser = useCallback(
    (userId: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!userId) {
        params.delete('user');
      } else {
        params.set('user', userId);
      }
      const qs = params.toString();
      startTransition(() => {
        router.push(qs ? `${basePath}?${qs}` : basePath);
      });
    },
    [router, searchParams, startTransition, basePath],
  );

  return (
    <div className={`flex flex-wrap items-center gap-2 ${isPending ? 'opacity-70' : ''}`}>
      <DateRangePicker from={from} to={to} onChange={setRange} compare={compare} onCompareChange={setCompare} />
      <select
        value={currentUser}
        onChange={(e) => updateUser(e.target.value || undefined)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
      >
        <option value="">Todos os vendedores</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.email.split('@')[0]}
          </option>
        ))}
      </select>
      {children}
    </div>
  );
}
