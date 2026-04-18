'use client';

import { useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

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
import type { ForecastDay } from '../types/start-new-leads';

interface StartNewLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const originLabels: Record<string, string> = {
  inbound_active: 'Inbound',
  inbound_passive: 'Inbound',
  outbound: 'Outbound',
};

interface ForecastTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ForecastTooltip({ active, payload, label }: ForecastTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div
      style={{
        backgroundColor: 'var(--popover)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        fontSize: '12px',
        padding: '8px 12px',
      }}
    >
      <p style={{ margin: 0, fontWeight: 500 }}>Dia {label}</p>
      {payload.map((entry) => (
        <p
          key={entry.name}
          style={{ margin: '2px 0 0', color: 'var(--muted-foreground)' }}
        >
          {entry.name === 'calls' ? 'Liga\u00e7\u00f5es' : 'Mensagens'}: {entry.value}
        </p>
      ))}
    </div>
  );
}

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
  } = useStartNewLeads(open);

  const effectiveQuantity = Math.min(quantity, totalAvailable);

  const totalForecastActivities = useMemo(
    () => forecast.reduce((sum, d) => sum + d.calls + d.messages, 0),
    [forecast],
  );

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Iniciar novos leads</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Zone 1 \u2014 Quantity Card */}
            <div className="flex items-center justify-between rounded-lg bg-[var(--muted)] px-4 py-3">
              <div>
                <p className="text-sm font-medium">Leads a iniciar</p>
                <p className="text-xs text-[var(--muted-foreground)]">
                  {'Quantidade de leads para inscrever nas cad\u00eancias selecionadas'}
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

            {/* Zone 2 \u2014 Cadence Table */}
            <div>
              <p className="text-sm font-medium">{'Selecione cad\u00eancias'}</p>
              <p className="mb-2 text-xs text-[var(--muted-foreground)]">
                {'Os leads ser\u00e3o inscritos nas cad\u00eancias selecionadas'}
              </p>

              {cadences.length === 0 ? (
                <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">
                  {'Nenhuma cad\u00eancia ativa encontrada.'}
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-[var(--muted)]/50 text-left text-xs text-[var(--muted-foreground)]">
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2">{'Cad\u00eancia'}</th>
                        <th className="px-3 py-2 text-right">{'Dispon\u00edveis'}</th>
                        <th className="px-3 py-2 text-right">Etapas</th>
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
                                <span className="font-medium">{cadence.name}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                  {originLabels[cadence.origin] ?? cadence.origin}
                                </Badge>
                              </div>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {cadence.availableLeads}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {cadence.totalSteps}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Zone 3 \u2014 Forecast Chart */}
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">{'Previs\u00e3o de atividades'}</p>
                <div className="flex items-center gap-3 text-[10px] text-[var(--muted-foreground)]">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: 'var(--primary)' }}
                    />
                    {'Liga\u00e7\u00f5es'}
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-sm"
                      style={{ backgroundColor: 'var(--primary)', opacity: 0.4 }}
                    />
                    Mensagens
                  </span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={140}>
                <BarChart
                  data={forecast}
                  margin={{ top: 4, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ForecastTooltip />} />
                  <Bar
                    dataKey="calls"
                    stackId="a"
                    fill="var(--primary)"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="messages"
                    stackId="a"
                    fill="var(--primary)"
                    fillOpacity={0.4}
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>

              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                {'Voc\u00ea receber\u00e1 ~'}{totalForecastActivities}{' atividades nos pr\u00f3ximos 14 dias.'}
              </p>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-xs text-[var(--muted-foreground)]">
                {totalAvailable}{' lead'}{totalAvailable !== 1 ? 's' : ''}{' dispon\u00edve'}{totalAvailable !== 1 ? 'is' : 'l'}
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
                  {'Iniciar '}{effectiveQuantity}{' lead'}{effectiveQuantity !== 1 ? 's' : ''}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
