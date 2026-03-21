'use client';

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

export interface ActivityFilterValues {
  status: string;
  channel: string;
  cadence: string;
  step: string;
  search: string;
}

interface ActivityFiltersProps {
  filters: ActivityFilterValues;
  onFiltersChange: (filters: ActivityFilterValues) => void;
  cadenceOptions: string[];
}

export const defaultFilters: ActivityFilterValues = {
  status: 'all',
  channel: 'all',
  cadence: 'all',
  step: 'all',
  search: '',
};

export function ActivityFilters({ filters, onFiltersChange, cadenceOptions }: ActivityFiltersProps) {
  function update(key: keyof ActivityFilterValues, value: string) {
    onFiltersChange({ ...filters, [key]: value });
  }

  const hasActiveFilters = Object.entries(filters).some(
    ([key, val]) => val !== defaultFilters[key as keyof ActivityFilterValues],
  );

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative w-64">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        <Input
          placeholder="Buscar lead ou cadência..."
          className="pl-9"
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
        />
      </div>

      {/* Status */}
      <Select value={filters.status} onValueChange={(v) => update('status', v)}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Status</SelectItem>
          <SelectItem value="overdue">Atrasada</SelectItem>
          <SelectItem value="due">No prazo</SelectItem>
        </SelectContent>
      </Select>

      {/* Channel */}
      <Select value={filters.channel} onValueChange={(v) => update('channel', v)}>
        <SelectTrigger className="w-[140px]">
          <SelectValue placeholder="Atividade" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas Atividades</SelectItem>
          <SelectItem value="email">E-mail</SelectItem>
          <SelectItem value="whatsapp">WhatsApp</SelectItem>
          <SelectItem value="phone">Ligação</SelectItem>
          <SelectItem value="linkedin">LinkedIn</SelectItem>
          <SelectItem value="research">Pesquisa</SelectItem>
        </SelectContent>
      </Select>

      {/* Cadence */}
      {cadenceOptions.length > 0 && (
        <Select value={filters.cadence} onValueChange={(v) => update('cadence', v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Cadência" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas Cadências</SelectItem>
            {cadenceOptions.map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Step */}
      <Select value={filters.step} onValueChange={(v) => update('step', v)}>
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Passo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos Passos</SelectItem>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
            <SelectItem key={n} value={String(n)}>Passo {n}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear */}
      {hasActiveFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onFiltersChange(defaultFilters)}
          className="gap-1 text-[var(--muted-foreground)] dark:text-[var(--foreground)]"
        >
          <X className="h-3.5 w-3.5" />
          Limpar
        </Button>
      )}
    </div>
  );
}
