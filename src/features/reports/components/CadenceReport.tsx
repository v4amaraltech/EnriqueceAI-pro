'use client';

import Link from 'next/link';
import { BarChart3 } from 'lucide-react';

import { DeltaIndicator } from '@/shared/components/DeltaIndicator';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import { calculateDelta } from '@/shared/utils/comparison';

import type { CadenceMetrics } from '../reports.contract';

interface CadenceReportProps {
  metrics: CadenceMetrics[];
  previousMetrics?: CadenceMetrics[];
  onRowClick?: (cadenceId: string) => void;
}

export function CadenceReport({ metrics, previousMetrics, onRowClick }: CadenceReportProps) {
  const prevMap = new Map(previousMetrics?.map((m) => [m.cadenceId, m]));
  if (metrics.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Nenhuma cadência ativa no período selecionado.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Performance por Cadência</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  <th className="pb-2 pr-4 font-medium">Cadência</th>
                  <th className="pb-2 pr-4 text-right font-medium">Inscritos</th>
                  <th className="pb-2 pr-4 text-right font-medium">Enviados</th>
                  <th className="pb-2 pr-4 text-right font-medium">Abertos</th>
                  <th className="pb-2 pr-4 text-right font-medium">Respondidos</th>
                  <th className="pb-2 pr-4 text-right font-medium">Bounce</th>
                  <th className="pb-2 pr-4 text-right font-medium">Reuniões</th>
                  <th className="pb-2 pr-4 text-right font-medium">Abertura</th>
                  <th className="pb-2 pr-4 text-right font-medium">Resposta</th>
                  <th className="pb-2 text-right font-medium">Conversão</th>
                  <th className="pb-2 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => {
                  const prev = prevMap.get(m.cadenceId);
                  return (
                    <tr
                      key={m.cadenceId}
                      className={`border-b border-[var(--border)] last:border-0 ${onRowClick ? 'cursor-pointer transition-colors hover:bg-[var(--accent)]' : ''}`}
                      onClick={() => onRowClick?.(m.cadenceId)}
                    >
                      <td className="py-2 pr-4 font-medium">{m.cadenceName}</td>
                      <td className="py-2 pr-4 text-right">{m.totalEnrollments}</td>
                      <td className="py-2 pr-4 text-right">{m.sent}</td>
                      <td className="py-2 pr-4 text-right">{m.opened}</td>
                      <td className="py-2 pr-4 text-right">{m.replied}</td>
                      <td className="py-2 pr-4 text-right">{m.bounced}</td>
                      <td className="py-2 pr-4 text-right">{m.meetings}</td>
                      <td className="py-2 pr-4 text-right">
                        <span>{m.openRate}%</span>
                        {prev && <DeltaIndicator delta={calculateDelta(m.openRate, prev.openRate)} />}
                      </td>
                      <td className="py-2 pr-4 text-right">
                        <span>{m.replyRate}%</span>
                        {prev && <DeltaIndicator delta={calculateDelta(m.replyRate, prev.replyRate)} />}
                      </td>
                      <td className="py-2 text-right font-medium">
                        <span>{m.conversionRate}%</span>
                        {prev && <DeltaIndicator delta={calculateDelta(m.conversionRate, prev.conversionRate)} />}
                      </td>
                      <td className="py-2 text-right">
                        <Link
                          href={`/cadences/${m.cadenceId}/performance`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)] transition-colors hover:text-[var(--foreground)]"
                          title="Ver performance detalhada"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Rate bars per cadence */}
      {metrics.map((m) => (
        <Card key={m.cadenceId}>
          <CardHeader>
            <CardTitle className="text-sm">{m.cadenceName}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <RateBar label="Abertura" value={m.openRate} color="bg-red-400" />
              <RateBar label="Resposta" value={m.replyRate} color="bg-green-500" />
              <RateBar label="Bounce" value={m.bounceRate} color="bg-red-500" />
              <RateBar label="Conversão" value={m.conversionRate} color="bg-red-600" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function RateBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--muted)]">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.max(value, 1)}%` }}
        />
      </div>
    </div>
  );
}
