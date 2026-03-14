'use client';

import { useCallback } from 'react';
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

export function LeadFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const currentSearch = searchParams.get('search') ?? '';
  const currentStatus = searchParams.get('status') ?? '';
  const currentEnrichment = searchParams.get('enrichment_status') ?? '';
  const currentPorte = searchParams.get('porte') ?? '';
  const currentUf = searchParams.get('uf') ?? '';
  const currentSource = searchParams.get('lead_source') ?? '';

  const hasFilters = currentStatus || currentEnrichment || currentPorte || currentUf || currentSource || currentSearch;

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
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
        <Input
          placeholder="Buscar lead por nome, email, empresa ou CNPJ..."
          className="pl-8"
          defaultValue={currentSearch}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              updateParam('search', e.currentTarget.value);
            }
          }}
        />
      </div>

      <div className="flex flex-wrap items-end gap-4">
        {/* Status */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Status</span>
          <Select
            value={currentStatus || ALL_VALUE}
            onValueChange={(v) => updateParam('status', v)}
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
            value={currentEnrichment || ALL_VALUE}
            onValueChange={(v) => updateParam('enrichment_status', v)}
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
            value={currentPorte || ALL_VALUE}
            onValueChange={(v) => updateParam('porte', v)}
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
            value={currentUf || ALL_VALUE}
            onValueChange={(v) => updateParam('uf', v)}
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
            value={currentSource || ALL_VALUE}
            onValueChange={(v) => updateParam('lead_source', v)}
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
