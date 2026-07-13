'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronDown, ListX, Search, User, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import type { LossReasonFilterOption } from '../actions/fetch-leads';
import type { LeadSourceOption } from '../actions/get-lead-source-options';
import { LEAD_SOURCE_OPTIONS, leadStatusValues } from '../schemas/lead.schemas';

const statusLabels: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  won: 'Ganho',
  unqualified: 'Não Qualificado',
  archived: 'Arquivado',
};

const ALL_VALUE = '__all__';

interface LeadFiltersProps {
  members?: { userId: string; name: string }[];
  cadences?: { id: string; name: string }[];
  cnaes?: string[];
  leadSourceOptions?: LeadSourceOption[];
  canalOptions?: string[];
  lossReasons?: LossReasonFilterOption[];
  currentUserId?: string;
}

export function LeadFilters({ members, cadences, cnaes: _cnaes, leadSourceOptions, canalOptions, lossReasons, currentUserId }: LeadFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceOptions = leadSourceOptions ?? LEAD_SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }));

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentEnrichment = searchParams.get('enrichment_status') ?? '';
  const currentPorte = searchParams.get('porte') ?? '';
  const currentUf = searchParams.get('uf') ?? '';
  const currentSource = searchParams.get('lead_source') ?? '';
  const currentAssigned = searchParams.get('assigned_to') ?? '';
  const currentCadence = searchParams.get('cadence_id') ?? '';
  const currentCnae = searchParams.get('cnae') ?? '';
  const currentCanal = searchParams.get('canal') ?? '';

  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingParamsRef = useRef<Record<string, string>>({});

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    };
  }, []);

  // Optimistic overrides for instant Select feedback
  const paramsKey = searchParams.toString();
  const [lastParamsKey, setLastParamsKey] = useState(paramsKey);
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  // Clear overrides when URL catches up (React-recommended render-time adjustment)
  if (paramsKey !== lastParamsKey) {
    setLastParamsKey(paramsKey);
    setOverrides({});
    setSearchValue(currentSearch);
  }

  const activeStatus = overrides.status ?? (currentStatus || ALL_VALUE);
  const _activeEnrichment = overrides.enrichment_status ?? (currentEnrichment || ALL_VALUE);
  const _activePorte = overrides.porte ?? (currentPorte || ALL_VALUE);
  const _activeUf = overrides.uf ?? (currentUf || ALL_VALUE);
  const activeSource = overrides.lead_source ?? (currentSource || ALL_VALUE);
  const _activeCnae = overrides.cnae ?? (currentCnae || ALL_VALUE);
  const activeCanal = overrides.canal ?? (currentCanal || ALL_VALUE);
  const activeCadence = overrides.cadence_id ?? (currentCadence || ALL_VALUE);
  const activeAssigned = overrides.assigned_to ?? (currentAssigned || ALL_VALUE);
  const currentLoss = searchParams.get('loss_reason_id') ?? '';
  const activeLoss = overrides.loss_reason_id ?? currentLoss;
  const selectedLossIds = activeLoss ? activeLoss.split(',').filter(Boolean) : [];

  const flushFilterParams = useCallback(() => {
    const pending = pendingParamsRef.current;
    if (Object.keys(pending).length === 0) return;
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(pending)) {
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    }
    params.delete('page');
    pendingParamsRef.current = {};
    router.push(`/leads?${params.toString()}`);
  }, [router, searchParams]);

  function handleFilterChange(key: string, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    // Batch rapid filter changes into a single navigation
    pendingParamsRef.current[key] = value;
    if (filterDebounceRef.current) clearTimeout(filterDebounceRef.current);
    filterDebounceRef.current = setTimeout(flushFilterParams, 300);
  }

  // Toggle one loss reason in/out of the multi-select. Rebuilds the comma-list
  // and reuses the same batched navigation as the other filters (empty → param
  // removed).
  function toggleLossReason(id: string) {
    const set = new Set(selectedLossIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    handleFilterChange('loss_reason_id', [...set].join(','));
  }

  const hasFilters = currentStatus || currentEnrichment || currentPorte || currentUf || currentSource || currentCanal || currentSearch || currentAssigned || currentCadence || currentCnae || currentLoss;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`/leads?${params.toString()}`);
    },
    [router, searchParams],
  );

  const clearFilters = useCallback(() => {
    router.push('/leads');
  }, [router]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        {/* Search (debounced) */}
        <div className="flex min-w-[220px] flex-1 flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Buscar</span>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
            <Input
              placeholder="Nome, email, empresa ou CNPJ..."
              className="pl-8"
              value={searchValue}
              onChange={(e) => {
                const v = e.target.value;
                setSearchValue(v);
                if (debounceRef.current) clearTimeout(debounceRef.current);
                debounceRef.current = setTimeout(() => {
                  updateParam('search', v);
                }, 400);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  updateParam('search', searchValue);
                }
              }}
            />
          </div>
        </div>
        {/* Status */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Status</span>
          <Select
            value={activeStatus}
            onValueChange={(v) => handleFilterChange('status', v)}
          >
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {leadStatusValues.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Origem */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Origem</span>
          <Select
            value={activeSource}
            onValueChange={(v) => handleFilterChange('lead_source', v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {sourceOptions.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sub-origem */}
        {canalOptions && canalOptions.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Sub-origem</span>
            <Select
              value={activeCanal}
              onValueChange={(v) => handleFilterChange('canal', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                {canalOptions.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Cadência */}
        {cadences && cadences.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Cadência</span>
            <Select
              value={activeCadence}
              onValueChange={(v) => handleFilterChange('cadence_id', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                <SelectItem value="__none__">Sem cadência</SelectItem>
                {cadences.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Motivo de Perda (multi-seleção) — isola os leads perdidos por motivo
            para re-inscrever numa cadência e reativar */}
        {lossReasons && lossReasons.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Motivo de Perda</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-9 w-[200px] justify-between font-normal">
                  <span className="truncate">
                    {selectedLossIds.length === 0
                      ? 'Todos'
                      : `${selectedLossIds.length} selecionado${selectedLossIds.length > 1 ? 's' : ''}`}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[340px] w-[280px] overflow-y-auto">
                <DropdownMenuLabel className="flex items-center justify-between">
                  <span>Motivo de Perda</span>
                  {selectedLossIds.length > 0 && (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs font-normal text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                      onClick={() => handleFilterChange('loss_reason_id', '')}
                    >
                      <ListX className="h-3.5 w-3.5" />
                      Limpar
                    </button>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {lossReasons.map((r) => (
                  <DropdownMenuCheckboxItem
                    key={r.id}
                    checked={selectedLossIds.includes(r.id)}
                    onCheckedChange={() => toggleLossReason(r.id)}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <span className="flex-1 truncate">{r.name}</span>
                    <span className="ml-2 text-xs tabular-nums text-[var(--muted-foreground)]">{r.count}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        {/* Responsável */}
        {members && members.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Responsável</span>
            <Select
              value={activeAssigned}
              onValueChange={(v) => handleFilterChange('assigned_to', v)}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                <SelectItem value="__unassigned__">Sem responsável</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Meus Leads toggle */}
        {currentUserId && (
          <Button
            variant={activeAssigned === currentUserId ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5 self-end"
            onClick={() => handleFilterChange('assigned_to', activeAssigned === currentUserId ? ALL_VALUE : currentUserId)}
          >
            <User className="h-3.5 w-3.5" />
            Meus leads
          </Button>
        )}

        {/* Clear filters */}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="mb-0.5">
            <X className="mr-1 h-4 w-4" />
            Limpar
          </Button>
        )}
      </div>
    </div>
  );
}
