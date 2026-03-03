'use client';

import { useCallback } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Filter } from 'lucide-react';

import { useOrganization } from '@/features/auth/hooks/useOrganization';

import { Button } from '@/shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import type { CadenceOption, DashboardFilters as Filters } from '../types';

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

function getLast12Months(): { value: string; label: string }[] {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    months.push({ value, label: label ?? value });
  }
  return months;
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

  const months = getLast12Months();
  const currentMonthLabel =
    months.find((m) => m.value === currentFilters.month)?.label ??
    currentFilters.month;

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

  const sdrMembers = members.filter((m) => m.status === 'active');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Month selector */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            {currentMonthLabel}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {months.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.value}
              checked={m.value === currentFilters.month}
              onCheckedChange={() => updateParams('month', m.value)}
            >
              {m.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Cadence filter */}
      {availableCadences.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Cadências
              {currentFilters.cadenceIds.length > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {currentFilters.cadenceIds.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            <DropdownMenuLabel>Filtrar por cadência</DropdownMenuLabel>
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
      )}

      {/* User filter — only visible to managers */}
      {isManager && sdrMembers.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Vendedores
              {currentFilters.userIds.length > 0 && (
                <span className="ml-1 rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                  {currentFilters.userIds.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
            <DropdownMenuLabel>Filtrar por vendedor</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {sdrMembers.map((m) => (
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
                {m.name ?? m.user_id.slice(0, 8)}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
