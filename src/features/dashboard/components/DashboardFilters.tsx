'use client';

import { useCallback } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { CalendarDays, ChevronDown } from 'lucide-react';

import { useOrganization } from '@/features/auth/hooks/useOrganization';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';

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

  const cadenceCount = currentFilters.cadenceIds.length > 0
    ? currentFilters.cadenceIds.length
    : availableCadences.length;

  const userCount = currentFilters.userIds.length > 0
    ? currentFilters.userIds.length
    : sdrMembers.length;

  const currentRange = searchParams.get('range') ?? '';
  const RANGE_PRESETS = [
    { value: '7d', label: '7 dias' },
    { value: '30d', label: '30 dias' },
    { value: '90d', label: '90 dias' },
  ];

  const handleRangePreset = useCallback((range: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentRange === range) {
      // Toggle off — go back to month view
      params.delete('range');
    } else {
      params.set('range', range);
    }
    router.push(`${pathname}?${params.toString()}`);
  }, [router, pathname, searchParams, currentRange]);

  return (
    <div className="flex flex-wrap items-center gap-1">
      {/* Range presets */}
      {RANGE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => handleRangePreset(preset.value)}
          className={`rounded-md px-2 py-1 text-sm transition-colors ${
            currentRange === preset.value
              ? 'bg-primary text-white'
              : 'text-foreground/70 hover:bg-accent hover:text-foreground'
          }`}
        >
          {preset.label}
        </button>
      ))}

      <span className="mx-1 text-[var(--border)]">|</span>

      {/* Month selector — inline dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
            !currentRange
              ? 'bg-accent text-foreground'
              : 'text-foreground/70 hover:bg-accent hover:text-foreground'
          }`}>
            <CalendarDays className="h-3.5 w-3.5" />
            <span>{currentMonthLabel.toLowerCase()}</span>
            <ChevronDown className="h-3 w-3 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {months.map((m) => (
            <DropdownMenuCheckboxItem
              key={m.value}
              checked={m.value === currentFilters.month && !currentRange}
              onCheckedChange={() => {
                const params = new URLSearchParams(searchParams.toString());
                params.set('month', m.value);
                params.delete('range');
                router.push(`${pathname}?${params.toString()}`);
              }}
            >
              {m.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

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
