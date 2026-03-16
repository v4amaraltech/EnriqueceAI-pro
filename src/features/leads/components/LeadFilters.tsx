'use client';

import { useCallback, useRef, useState } from 'react';
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

import { enrichmentStatusValues, LEAD_SOURCE_OPTIONS, leadStatusValues } from '../schemas/lead.schemas';

const statusLabels: Record<string, string> = {
  new: 'Novo',
  contacted: 'Contatado',
  qualified: 'Qualificado',
  unqualified: 'Não Qualificado',
  archived: 'Arquivado',
};

const enrichmentLabels: Record<string, string> = {
  pending: 'Pendente',
  enriching: 'Enriquecendo',
  enriched: 'Enriquecido',
  enrichment_failed: 'Falhou',
  not_found: 'Não Encontrado',
};

const porteOptions = [
  { value: 'MEI', label: 'MEI' },
  { value: 'ME', label: 'ME' },
  { value: 'EPP', label: 'EPP' },
  { value: 'DEMAIS', label: 'Demais' },
];

const ufOptions = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const ALL_VALUE = '__all__';

interface LeadFiltersProps {
  members?: { userId: string; name: string }[];
  cadences?: { id: string; name: string }[];
  cnaes?: string[];
}

export function LeadFilters({ members, cadences, cnaes }: LeadFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentEnrichment = searchParams.get('enrichment_status') ?? '';
  const currentPorte = searchParams.get('porte') ?? '';
  const currentUf = searchParams.get('uf') ?? '';
  const currentSource = searchParams.get('lead_source') ?? '';
  const currentAssigned = searchParams.get('assigned_to') ?? '';
  const currentCadence = searchParams.get('cadence_id') ?? '';
  const currentCnae = searchParams.get('cnae') ?? '';

  const [searchValue, setSearchValue] = useState(currentSearch);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const activeEnrichment = overrides.enrichment_status ?? (currentEnrichment || ALL_VALUE);
  const activePorte = overrides.porte ?? (currentPorte || ALL_VALUE);
  const activeUf = overrides.uf ?? (currentUf || ALL_VALUE);
  const activeSource = overrides.lead_source ?? (currentSource || ALL_VALUE);
  const activeCnae = overrides.cnae ?? (currentCnae || ALL_VALUE);
  const activeCadence = overrides.cadence_id ?? (currentCadence || ALL_VALUE);
  const activeAssigned = overrides.assigned_to ?? (currentAssigned || ALL_VALUE);

  function handleFilterChange(key: string, value: string) {
    setOverrides((prev) => ({ ...prev, [key]: value }));
    updateParam(key, value);
  }

  const hasFilters = currentStatus || currentEnrichment || currentPorte || currentUf || currentSource || currentSearch || currentAssigned || currentCadence || currentCnae;

  const updateParam = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value && value !== ALL_VALUE) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      // Reset to page 1 on filter change
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
      {/* Search (debounced) */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
        <Input
          placeholder="Buscar lead por nome, email, empresa ou CNPJ..."
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

      <div className="flex flex-wrap items-end gap-4">
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

        {/* Enrichment */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Enriquecimento</span>
          <Select
            value={activeEnrichment}
            onValueChange={(v) => handleFilterChange('enrichment_status', v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {enrichmentStatusValues.map((s) => (
                <SelectItem key={s} value={s}>
                  {enrichmentLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Porte */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Porte</span>
          <Select
            value={activePorte}
            onValueChange={(v) => handleFilterChange('porte', v)}
          >
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {porteOptions.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* UF */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">UF</span>
          <Select
            value={activeUf}
            onValueChange={(v) => handleFilterChange('uf', v)}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {ufOptions.map((uf) => (
                <SelectItem key={uf} value={uf}>
                  {uf}
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
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>Todos</SelectItem>
              {LEAD_SOURCE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* CNAE */}
        {cnaes && cnaes.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">CNAE</span>
            <Select
              value={activeCnae}
              onValueChange={(v) => handleFilterChange('cnae', v)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_VALUE}>Todos</SelectItem>
                {cnaes.map((c) => (
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
