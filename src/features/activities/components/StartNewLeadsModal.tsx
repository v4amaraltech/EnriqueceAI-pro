'use client';

import { useMemo, useState } from 'react';
import { Info, Loader2 } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';
import { Checkbox } from '@/shared/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';

import { useStartNewLeads } from '../hooks/useStartNewLeads';

interface StartNewLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const originLabels: Record<string, string> = {
  inbound_active: 'Inbound',
  inbound_passive: 'Inbound',
  outbound: 'Outbound',
};

const MAX_BAR_HEIGHT = 120;
const DAILY_TARGET = 80;

export function StartNewLeadsModal({
  open,
  onOpenChange,
}: StartNewLeadsModalProps) {
  const {
    cadences,
    isLoading,
    totalAvailable,
    forecast,
    selectedIds,
    toggleCadence,
    quantity,
    setQuantity,
    startLeads,
    isStarting,
    todayActivities,
    newActivitiesPerDay,
  } = useStartNewLeads(open);

  const effectiveQuantity = Math.min(quantity, totalAvailable);

  // Build chart data with new + existing activities
  const chartData = useMemo(() => {
    return forecast.map((day) => {
      const newAct = newActivitiesPerDay(day.dayOffset);
      const existing = day.existingActivities;
      return {
        dayLabel: day.dayLabel,
        dayOffset: day.dayOffset,
        newActivities: newAct,
        existingActivities: existing,
        total: newAct + existing,
      };
    });
  }, [forecast, newActivitiesPerDay]);

  const maxTotal = useMemo(
    () => Math.max(...chartData.map((d) => d.total), 1),
    [chartData],
  );

  // Find peak day
  const peakDay = useMemo(() => {
    let peak = chartData[0];
    for (const day of chartData) {
      if (peak && day.total > peak.total) {
        peak = day;
      }
    }
    return peak;
  }, [chartData]);

  // First day activities formula parts
  const selectedCadences = useMemo(
    () => cadences.filter((c) => selectedIds.has(c.id)),
    [cadences, selectedIds],
  );

  const avgFirstDayActivities = useMemo(() => {
    if (selectedCadences.length === 0) return 0;
    return Math.round(
      selectedCadences.reduce((sum, c) => sum + c.firstDayActivities, 0) /
        selectedCadences.length,
    );
  }, [selectedCadences]);

  const isWarningToday = todayActivities > 60;

  // Insight text
  const insightText = useMemo(() => {
    const todayTotal = chartData[0];
    if (!todayTotal || !peakDay) return '';

    const todayTotalVal = todayTotal.total;
    const todayPercent = Math.round((todayTotalVal / DAILY_TARGET) * 100);

    if (todayTotalVal > DAILY_TARGET) {
      return `Atenção: hoje ficaria em ${todayPercent}% da meta diária.`;
    }

    const allUnderTarget = chartData.every((d) => d.total <= DAILY_TARGET);
    if (allUnderTarget) {
      return 'Ritmo sustentável pra 5 dias.';
    }

    return `Pico em ${peakDay.dayLabel} · ${peakDay.total} atividades.`;
  }, [chartData, peakDay]);

  const isInsightWarning = useMemo(() => {
    const todayTotal = chartData[0];
    return todayTotal ? todayTotal.total > DAILY_TARGET : false;
  }, [chartData]);

  function handleQuantityChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value, 10);
    if (Number.isNaN(val)) {
      setQuantity(1);
    } else {
      setQuantity(Math.max(1, Math.min(50, val)));
    }
  }

  function handleStart() {
    startLeads();
    onOpenChange(false);
  }

  // Tooltip state for chart bars
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl h-[95vh] overflow-y-auto">
        {/* Zone 1 - Header */}
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between">
            Iniciar novos leads
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Zone 2 - Quantity Card */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] px-4 py-3">
              <div>
                <p className="text-sm font-medium">Leads a iniciar</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Serão disparados agora na sua fila.
                </p>
              </div>
              <Input
                type="number"
                min={1}
                max={50}
                value={quantity}
                onChange={handleQuantityChange}
                className="w-16 text-center"
                autoFocus
              />
            </div>

            {/* Zone 3 - Today additional activities card */}
            <div
              className={`rounded-lg border p-4 flex items-center justify-between ${
                isWarningToday
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-[var(--primary)]/10 border-[var(--primary)]/30'
              }`}
            >
              <div>
                <p className="text-sm font-medium">
                  Atividades adicionais hoje
                </p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {effectiveQuantity} leads × {avgFirstDayActivities} ativ. no passo 1
                </p>
              </div>
              <span
                className={`font-mono text-2xl font-bold ${
                  isWarningToday
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-[var(--primary)]'
                }`}
              >
                +{todayActivities}
              </span>
            </div>

            {/* Zone 4 - Cadence Table */}
            <div>
              <p className="text-sm font-medium">Selecione cadências</p>
              <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                Os leads serão inscritos nas cadências selecionadas
              </p>

              {cadences.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
                  Nenhuma cadência ativa encontrada.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-[var(--muted)]/50 text-left text-xs text-[var(--muted-foreground)]">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2">Cadência</th>
                        <th className="px-3 py-2 text-right">Disponíveis</th>
                        <th className="px-3 py-2 text-right">Etapas</th>
                        <th className="px-3 py-2 text-right">Ativ/d1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cadences.map((cadence) => {
                        const isSelected = selectedIds.has(cadence.id);
                        return (
                          <tr
                            key={cadence.id}
                            className="cursor-pointer border-b last:border-b-0 hover:bg-[var(--muted)]/50 transition-colors"
                            onClick={() => toggleCadence(cadence.id)}
                          >
                            <td className="px-3 py-2">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleCadence(cadence.id)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">
                                  {cadence.name}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className="text-[10px] px-1.5 py-0"
                                >
                                  {originLabels[cadence.origin] ??
                                    cadence.origin}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {cadence.availableLeads}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {cadence.totalSteps}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {cadence.firstDayActivities}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Zone 5 - Forecast Chart (Pure CSS) */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium">
                  Previsão · próximos 5 dias úteis
                </p>
                <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--muted-foreground)]/30" />
                    Já agendadas
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--primary)]" />
                    Novas
                  </span>
                </div>
              </div>

              <div className="flex items-end gap-3" style={{ height: MAX_BAR_HEIGHT + 48 }}>
                {chartData.map((day, i) => {
                  const newHeight =
                    maxTotal > 0
                      ? (day.newActivities / maxTotal) * MAX_BAR_HEIGHT
                      : 0;
                  const existingHeight =
                    maxTotal > 0
                      ? (day.existingActivities / maxTotal) * MAX_BAR_HEIGHT
                      : 0;

                  return (
                    <div
                      key={day.dayOffset}
                      className="relative flex flex-1 flex-col items-center"
                      onMouseEnter={() => setHoveredBar(i)}
                      onMouseLeave={() => setHoveredBar(null)}
                    >
                      {/* Top label - total */}
                      <span className="mb-1 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                        {day.total}
                      </span>

                      {/* Stacked bars container */}
                      <div
                        className="flex w-full flex-col justify-end"
                        style={{ height: MAX_BAR_HEIGHT }}
                      >
                        {/* New activities (top) */}
                        <div
                          className="w-full rounded-t-sm bg-[var(--primary)] transition-all duration-300 ease-out"
                          style={{ height: Math.max(newHeight, newHeight > 0 ? 2 : 0) }}
                        />
                        {/* Existing activities (bottom) */}
                        <div
                          className="w-full bg-[var(--muted-foreground)]/20 transition-all duration-300 ease-out"
                          style={{
                            height: Math.max(existingHeight, existingHeight > 0 ? 2 : 0),
                            borderRadius:
                              newHeight === 0
                                ? '4px 4px 0 0'
                                : '0',
                          }}
                        />
                      </div>

                      {/* Bottom label - day name */}
                      <span className="mt-1 text-[10px] text-[var(--muted-foreground)]">
                        {day.dayLabel}
                      </span>

                      {/* Tooltip on hover */}
                      {hoveredBar === i && (
                        <div className="absolute -top-16 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-[var(--popover)] px-3 py-2 text-[11px] shadow-md">
                          <p className="font-medium">{day.dayLabel}</p>
                          <p className="text-[var(--muted-foreground)]">
                            Novas: {day.newActivities}
                          </p>
                          <p className="text-[var(--muted-foreground)]">
                            Já agendadas: {day.existingActivities}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Zone 6 - Insight callout */}
            {insightText && (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${
                  isInsightWarning
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                }`}
              >
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{insightText}</span>
              </div>
            )}

            {/* Zone 7 - Footer */}
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                {totalAvailable} lead{totalAvailable !== 1 ? 's' : ''}{' '}
                disponíve{totalAvailable !== 1 ? 'is' : 'l'}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onOpenChange(false)}
                  disabled={isStarting}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleStart}
                  disabled={
                    isStarting ||
                    selectedIds.size === 0 ||
                    totalAvailable === 0
                  }
                >
                  {isStarting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Iniciar {effectiveQuantity} lead
                  {effectiveQuantity !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
