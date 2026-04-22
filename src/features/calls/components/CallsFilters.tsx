'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { callStatusValues } from '../schemas/call.schemas';
import type { OrgMemberOption } from '@/features/leads/actions/fetch-org-members';

const statusLabels: Record<string, string> = {
  significant: 'Significativa',
  not_significant: 'Não Significativa',
  no_contact: 'Sem Contato',
  busy: 'Ocupado',
  not_connected: 'Não Conectada',
};

const periodOptions = [
  { value: 'today', label: 'Hoje' },
  { value: 'week', label: 'Esta Semana' },
  { value: 'month', label: 'Este Mês' },
  { value: 'all', label: 'Todo Período' },
];

const ALL_VALUE = '__all__';

export function CallsFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentPeriod = searchParams.get('period') ?? '';
  const currentUserId = searchParams.get('user_id') ?? '';
  const currentImportant = searchParams.get('important_only') === 'true';

  const [members, setMembers] = useState<OrgMemberOption[]>([]);

  useEffect(() => {
    import('@/features/leads/actions/fetch-org-members').then(({ fetchOrgMembersAuth }) =>
      fetchOrgMembersAuth().then((res) => {
        if (res.success) setMembers(res.data);
      }),
    );
  }, []);

  // Optimistic overrides for instant Select feedback
  const paramsKey = searchParams.toString();
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setOverrides({});
  }

  const activeStatus = overrides.status ?? (currentStatus || ALL_VALUE);
  const activePeriod = overrides.period ?? (currentPeriod || ALL_VALUE);
  const activeUserId = overrides.user_id ?? (currentUserId || ALL_VALUE);

  function handleFilterChange(key: string, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    updateParam(key, value);
  }

  const hasFilters = currentStatus || currentPeriod || currentSearch || currentImportant || currentUserId;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`/calls?${params.toString()}`);
    },
    [router, searchParams],
  );

  const toggleImportant = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (currentImportant) {
      params.delete('important_only');
    } else {
      params.set('important_only', 'true');
    }
    params.delete('page');
    router.push(`/calls?${params.toString()}`);
  }, [router, searchParams, currentImportant]);

  const clearFilters = useCallback(() => {
    router.push('/calls');
  }, [router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por origem, destino ou notas..."
            className="pl-8"
            defaultValue={currentSearch}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                updateParam('search', e.currentTarget.value);
              }
            }}
          />
        </div>

        {/* Status */}
        <Select
          value={activeStatus}
          onValueChange={(v) => handleFilterChange('status', v)}
        >
          <SelectTrigger className="w-full sm:w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todos status</SelectItem>
            {callStatusValues.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabels[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Period */}
        <Select
          value={activePeriod}
          onValueChange={(v) => handleFilterChange('period', v)}
        >
          <SelectTrigger className="w-full sm:w-[150px]">
            <SelectValue placeholder="Período" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>Todo Período</SelectItem>
            {periodOptions.filter((p) => p.value !== 'all').map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* SDR filter */}
        {members.length > 1 && (
          <Select
            value={activeUserId}
            onValueChange={(v) => handleFilterChange('user_id', v)}
          >
            <SelectTrigger className="w-full sm:w-[170px]">
              <SelectValue placeholder="SDR" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos SDRs</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Important toggle */}
        <Button
          variant={currentImportant ? 'default' : 'outline'}
          size="sm"
          onClick={toggleImportant}
        >
          Importantes
        </Button>

        {/* Clear filters */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-4 w-4" />
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
