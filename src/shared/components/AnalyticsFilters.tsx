'use client';

import { useCallback, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { DateRangePicker } from '@/shared/components/DateRangePicker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';
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

      <Select value={currentSdr || '__all__'} onValueChange={(v) => updateParam('sdr', v === '__all__' ? undefined : v)}>
        <SelectTrigger className="h-8 w-[180px]">
          <SelectValue placeholder="Todos os vendedores" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all__">Todos os vendedores</SelectItem>
          {members.map((m) => (
            <SelectItem key={m.userId} value={m.userId}>
              {m.name ?? m.email.split('@')[0]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {cadences && cadences.length > 0 && (
        <Select value={currentCadence || '__all__'} onValueChange={(v) => updateParam('cadence', v === '__all__' ? undefined : v)}>
          <SelectTrigger className="h-8 w-[180px]">
            <SelectValue placeholder="Todas as cadências" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">Todas as cadências</SelectItem>
            {cadences.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {children}
    </div>
  );
}
