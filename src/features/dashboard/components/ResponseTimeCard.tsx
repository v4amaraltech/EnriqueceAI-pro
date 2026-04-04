'use client';

import { useState, useTransition } from 'react';
import { Filter, X } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/components/ui/popover';
import { Avatar, AvatarFallback, AvatarImage } from '@/shared/components/ui/avatar';

import { getResponseTimeData } from '../actions/get-response-time';
import type { DashboardResponseTimeData } from '../types';

function formatThreshold(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

const CADENCE_FOCUS_OPTIONS = [
  { value: 'inbound_active', label: 'Inbound ativo' },
  { value: 'inbound_passive', label: 'Inbound passivo' },
  { value: 'outbound', label: 'Outbound' },
];

const DAY_OPTIONS = [
  { value: 1, label: 'Seg' },
  { value: 2, label: 'Ter' },
  { value: 3, label: 'Qua' },
  { value: 4, label: 'Qui' },
  { value: 5, label: 'Sex' },
  { value: 6, label: 'Sáb' },
  { value: 0, label: 'Dom' },
];

interface Filters {
  cadenceFocus: Set<string>;
  days: Set<number>;
  timeFrom: string;
  timeTo: string;
}

const DEFAULT_FILTERS: Filters = {
  cadenceFocus: new Set(['inbound_active', 'inbound_passive', 'outbound']),
  days: new Set([1, 2, 3, 4, 5]),
  timeFrom: '09:00',
  timeTo: '17:59',
};

interface ResponseTimeCardProps {
  data: DashboardResponseTimeData;
}

export function ResponseTimeCard({ data }: ResponseTimeCardProps) {
  const threshold = formatThreshold(data.thresholdMinutes);
  const [filters, setFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [tempFilters, setTempFilters] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [filterOpen, setFilterOpen] = useState(false);
  const [filteredData, setFilteredData] = useState<DashboardResponseTimeData>(data);
  const [isPending, startTransition] = useTransition();
  function toggleCadenceFocus(value: string) {
    setTempFilters((prev) => {
      const next = new Set(prev.cadenceFocus);
      if (next.has(value)) next.delete(value); else next.add(value);
      return { ...prev, cadenceFocus: next };
    });
  }

  function toggleDay(day: number) {
    setTempFilters((prev) => {
      const next = new Set(prev.days);
      if (next.has(day)) next.delete(day); else next.add(day);
      return { ...prev, days: next };
    });
  }

  function applyFilters() {
    const applied = { ...tempFilters };
    setFilters(applied);
    setFilterOpen(false);

    const isDefault =
      applied.cadenceFocus.size === 3 &&
      applied.days.size === 5 &&
      applied.timeFrom === '09:00' &&
      applied.timeTo === '17:59';

    if (isDefault) {
      setFilteredData(data);
      return;
    }

    startTransition(async () => {
      const result = await getResponseTimeData(data.thresholdMinutes, undefined, {
        cadenceFocus: [...applied.cadenceFocus],
        days: [...applied.days],
        timeFrom: applied.timeFrom,
        timeTo: applied.timeTo,
      });
      if (result.success) setFilteredData(result.data);
    });
  }

  function cancelFilters() {
    setTempFilters({ ...filters });
    setFilterOpen(false);
  }

  const hasActiveFilters =
    filters.cadenceFocus.size !== 3 ||
    filters.days.size !== 5 ||
    filters.timeFrom !== '09:00' ||
    filters.timeTo !== '17:59';

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 min-h-[480px] flex flex-col">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Tempo de resposta</h2>
        <div className="flex items-center gap-2">
        <Popover open={filterOpen} onOpenChange={(open) => {
          if (open) setTempFilters({ ...filters });
          setFilterOpen(open);
        }}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Filter className="h-3.5 w-3.5" />
              Filtros
              {hasActiveFilters && <span className="h-2 w-2 rounded-full bg-primary" />}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[380px] p-0" align="end">
            <div className="p-4 space-y-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">FILTROS</h3>
                <button type="button" onClick={() => setFilterOpen(false)}>
                  <X className="h-4 w-4 text-[var(--muted-foreground)]" />
                </button>
              </div>

              {/* Foco da cadência */}
              <div className="space-y-2">
                <Label className="text-xs text-[var(--muted-foreground)]">Foco da cadência:</Label>
                <div className="flex flex-wrap gap-3">
                  {CADENCE_FOCUS_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={tempFilters.cadenceFocus.has(opt.value)}
                        onCheckedChange={() => toggleCadenceFocus(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Lead recebido nos dias */}
              <div className="space-y-2">
                <Label className="text-xs text-[var(--muted-foreground)]">Lead recebido nos dias:</Label>
                <div className="flex flex-wrap gap-3">
                  {DAY_OPTIONS.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={tempFilters.days.has(opt.value)}
                        onCheckedChange={() => toggleDay(opt.value)}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Horário de recebimento */}
              <div className="space-y-2">
                <Label className="text-xs text-[var(--muted-foreground)]">Horário de recebimento do lead:</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    value={tempFilters.timeFrom}
                    onChange={(e) => setTempFilters((prev) => ({ ...prev, timeFrom: e.target.value }))}
                    className="w-[120px]"
                  />
                  <span className="text-sm text-[var(--muted-foreground)]">até</span>
                  <Input
                    type="time"
                    value={tempFilters.timeTo}
                    onChange={(e) => setTempFilters((prev) => ({ ...prev, timeTo: e.target.value }))}
                    className="w-[120px]"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border)]">
                <Button variant="outline" size="sm" onClick={cancelFilters}>Cancelar</Button>
                <Button size="sm" onClick={applyFilters}>Aplicar</Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        </div>
      </div>

      <div className={`flex flex-col gap-6 lg:flex-row flex-1 transition-opacity ${isPending ? 'opacity-50' : ''}`}>
        {/* Left: KPI */}
        <div className="flex flex-col items-center justify-center lg:w-1/2 lg:border-r lg:border-[var(--border)] lg:pr-10">
          <p className="text-7xl font-bold">{filteredData.overallPct}%</p>
          <p className="mt-3 text-base text-center">
            abordados em até <span className="text-primary font-semibold">{threshold}</span>
          </p>
          <p className="mt-6 text-sm text-[var(--muted-foreground)] text-center max-w-[300px] leading-relaxed">
            O tempo de resposta mede o tempo corrido entre o recebimento do lead na plataforma e a primeira atividade do vendedor.
          </p>
        </div>

        {/* Right: SDR table */}
        <div className="flex-1 min-w-0">
          {filteredData.byUser.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr className="text-[var(--muted-foreground)] text-sm">
                  <th className="pb-4 text-left font-medium" />
                  <th className="pb-4 text-center font-medium">leads abordados</th>
                  <th className="pb-4 text-center font-medium">em até {threshold}</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.byUser.map((user) => (
                  <tr key={user.userId} className="border-t border-[var(--border)]">
                    <td className="py-4">
                      <div className="flex items-center gap-3">
                        <Avatar size="sm">
                          {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.userName} />}
                          <AvatarFallback className="text-xs font-medium">
                            {user.userName.split(' ').map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-base font-medium">{user.userName}</span>
                      </div>
                    </td>
                    <td className="py-4 text-center text-base font-semibold">{user.leadsApproached}</td>
                    <td className="py-4 text-center text-base">
                      <span className="font-semibold">{user.withinThreshold}</span>
                      <span className="text-[var(--muted-foreground)] ml-1">({user.withinThresholdPct}%)</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] text-center py-8">
              Nenhum lead abordado no período.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
