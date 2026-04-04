'use client';

import { useCallback } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ChevronDown } from 'lucide-react';

import { useOrganization } from '@/features/auth/hooks/useOrganization';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';
import { DateRangePicker } from '@/shared/components/DateRangePicker';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import type { CadenceOption, DashboardFilters as Filters } from '../types';

function GreenDot() {
  return <span className="mx-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />;
}

interface DashboardFiltersProps {
  currentFilters: Filters;
  availableCadences: CadenceOption[];
}

export function DashboardFilters({
  currentFilters,
  availableCadences,
}: DashboardFiltersProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { members, isManager } = useOrganization();

  const updateParams = useCallback(
    (key: string, value: string | string[]) => {
      const params = new URLSearchParams(searchParams.toString());
      if (Array.isArray(value)) {
        params.delete(key);
        if (value.length > 0) {
          params.set(key, value.join(','));
        }
      } else {
        params.set(key, value);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const toggleArrayParam = useCallback(
    (key: string, id: string, currentIds: string[]) => {
      const next = currentIds.includes(id)
        ? currentIds.filter((x) => x !== id)
        : [...currentIds, id];
      updateParams(key, next);
    },
    [updateParams],
  );

  const handleDateRangeChange = useCallback(
    (from: string, to: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set('dateFrom', from);
      params.set('dateTo', to);
      params.delete('month');
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams],
  );

  const sdrMembers = members.filter((m) => m.status === 'active');

  const cadenceCount = currentFilters.cadenceIds.length > 0
    ? currentFilters.cadenceIds.length
    : availableCadences.length;

  const userCount = currentFilters.userIds.length > 0
    ? currentFilters.userIds.length
    : sdrMembers.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Date range picker */}
      <DateRangePicker
        from={currentFilters.dateFrom!}
        to={currentFilters.dateTo!}
        onChange={handleDateRangeChange}
      />

      {/* Cadence filter */}
      {availableCadences.length > 0 && (
        <>
          <GreenDot />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
                <span>{cadenceCount} cadências</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              <DropdownMenuLabel>Filtrar por cadência</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={currentFilters.cadenceIds.length === 0}
                onCheckedChange={() => updateParams('cadenceIds', [])}
              >
                Todos
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {availableCadences.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={currentFilters.cadenceIds.includes(c.id)}
                  onCheckedChange={() =>
                    toggleArrayParam(
                      'cadenceIds',
                      c.id,
                      currentFilters.cadenceIds,
                    )
                  }
                >
                  {c.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* User filter — only visible to managers */}
      {isManager && sdrMembers.length > 1 && (
        <>
          <GreenDot />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
                <span>{userCount} vendedores</span>
                <ChevronDown className="h-3 w-3 opacity-50" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
              <DropdownMenuLabel>Filtrar por vendedor</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={currentFilters.userIds.length === 0}
                onCheckedChange={() => updateParams('userIds', [])}
              >
                Todos
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              {sdrMembers.map((m) => {
                const displayName = m.name ?? m.user_id.slice(0, 8);
                const initials = displayName
                  .split(' ')
                  .map((w) => w[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase();
                return (
                  <DropdownMenuCheckboxItem
                    key={m.user_id}
                    checked={currentFilters.userIds.includes(m.user_id)}
                    onCheckedChange={() =>
                      toggleArrayParam(
                        'userIds',
                        m.user_id,
                        currentFilters.userIds,
                      )
                    }
                  >
                    <Avatar className="mr-2 h-5 w-5 text-[10px]">
                      {m.avatar_url && <AvatarImage src={m.avatar_url} alt={displayName} />}
                      <AvatarFallback className="text-[10px]">{initials}</AvatarFallback>
                    </Avatar>
                    {displayName}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}
