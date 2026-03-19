'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import { useDateRange } from '@/shared/hooks/useDateRange';

import type { OrgMember } from '@/features/statistics/types/shared';
import type { CadenceOption } from '@/features/statistics/actions/fetch-active-cadence-options';

export type { OrgMember, CadenceOption };

interface AnalyticsFiltersProps {
  basePath: string;
  members: OrgMember[];
  cadences?: CadenceOption[];
  showCompare?: boolean;
  children?: React.ReactNode;
}

export function AnalyticsFilters({
  basePath,
  members,
  cadences,
  showCompare = true,
  children,
}: AnalyticsFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const { from, to, setRange, compare, setCompare } = useDateRange(basePath);

  const currentSdr = searchParams.get('sdr') ?? '';
  const currentCadence = searchParams.get('cadence') ?? '';

  const updateParam = useCallback(
    (key: string, value: string | undefined) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value) {
        params.delete(key);
      } else {
        params.set(key, value);
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
      <DateRangePicker
        from={from}
        to={to}
        onChange={setRange}
        compare={showCompare ? compare : undefined}
        onCompareChange={showCompare ? setCompare : undefined}
      />

      <select
        value={currentSdr}
        onChange={(e) => updateParam('sdr', e.target.value || undefined)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
      >
        <option value="">Todos os vendedores</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.email.split('@')[0]}
          </option>
        ))}
      </select>

      {cadences && cadences.length > 0 && (
        <select
          value={currentCadence}
          onChange={(e) => updateParam('cadence', e.target.value || undefined)}
          className="h-8 rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-sm"
        >
          <option value="">Todas as cadências</option>
          {cadences.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}

      {children}
    </div>
  );
}
