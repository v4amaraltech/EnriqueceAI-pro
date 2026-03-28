'use client';

import { LeadAvatar } from '@/features/leads/components/LeadAvatar';

import type { DashboardResponseTimeData } from '../types';

function formatThreshold(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? '1 hora' : `${hours} horas`;
}

interface ResponseTimeCardProps {
  data: DashboardResponseTimeData;
}

export function ResponseTimeCard({ data }: ResponseTimeCardProps) {
  const threshold = formatThreshold(data.thresholdMinutes);

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-6 min-h-[480px]">
      <h2 className="text-lg font-semibold mb-6">Tempo de resposta</h2>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: KPI */}
        <div className="flex flex-col items-center justify-center lg:w-[320px] lg:border-r lg:border-[var(--border)] lg:pr-8">
          <p className="text-5xl font-bold">{data.overallPct}%</p>
          <p className="mt-2 text-sm text-center">
            abordados em até <span className="text-[#E53935] font-semibold">{threshold}</span>
          </p>
          <p className="mt-4 text-xs text-[var(--muted-foreground)] text-center max-w-[280px]">
            O tempo de resposta mede o tempo corrido entre o recebimento do lead na plataforma e a primeira atividade do vendedor.
          </p>
        </div>

        {/* Right: SDR table */}
        <div className="flex-1 min-w-0">
          {data.byUser.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[var(--muted-foreground)]">
                  <th className="pb-3 text-left font-medium" />
                  <th className="pb-3 text-right font-medium">leads abordados</th>
                  <th className="pb-3 text-right font-medium">em até {formatThreshold(data.thresholdMinutes)}</th>
                </tr>
              </thead>
              <tbody>
                {data.byUser.map((user) => (
                  <tr key={user.userId} className="border-t border-[var(--border)]">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <LeadAvatar name={user.userName} size="sm" />
                        <span className="font-medium">{user.userName}</span>
                      </div>
                    </td>
                    <td className="py-3 text-right font-semibold">{user.leadsApproached}</td>
                    <td className="py-3 text-right">
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
