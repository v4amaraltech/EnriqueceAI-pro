'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Calendar, CheckCircle2, Mail, MessageSquare, Send, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';

import { Button } from '@/shared/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';
import {
  ENROLLMENT_STATUS_COLORS,
  ENROLLMENT_STATUS_LABELS,
} from '@/shared/constants/chart-colors';

import type { CadencePerformanceData, PerformancePeriod } from '../cadences.contract';
import { AbTestDashboard } from './AbTestDashboard';
import { StepPerformanceTable } from './StepPerformanceTable';
import { StepProgressChart } from './StepProgressChart';
import { StepRatesBarChart } from './StepRatesBarChart';

interface CadencePerformanceViewProps {
  data: CadencePerformanceData;
  period: PerformancePeriod;
}

const periods: { value: PerformancePeriod; label: string }[] = [
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: 'all', label: 'Tudo' },
];

export function CadencePerformanceView({ data, period }: CadencePerformanceViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const setPeriod = useCallback(
    (p: PerformancePeriod) => {
      const params = new URLSearchParams(searchParams.toString());
      if (p === 'all') {
        params.delete('period');
      } else {
        params.set('period', p);
      }
      const qs = params.toString();
      router.push(`/cadences/${data.cadenceId}/performance${qs ? `?${qs}` : ''}`);
    },
    [router, searchParams, data.cadenceId],
  );

  const { summary, enrollments, steps, cadenceType } = data;
  const isStandard = cadenceType === 'standard';

  const abStepIds = useMemo(
    () => steps.filter((s) => s.abEnabled).map((s) => s.stepId),
    [steps],
  );

  // Donut data
  const donutData = (['active', 'paused', 'completed', 'replied', 'bounced', 'unsubscribed'] as const)
    .map((status) => ({
      name: ENROLLMENT_STATUS_LABELS[status] ?? status,
      value: enrollments[status],
      color: ENROLLMENT_STATUS_COLORS[status] ?? '#6b7280',
    }))
    .filter((d) => d.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Link href={`/cadences/${data.cadenceId}`}>
            <Button variant="ghost" size="icon" aria-label="Voltar">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">{data.cadenceName}</h1>
            <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Performance detalhada por etapa</p>
          </div>
        </div>
        <div className="flex gap-1">
          {periods.map((p) => (
            <Button
              key={p.value}
              variant={period === p.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setPeriod(p.value)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {isStandard ? (
          <>
            <KpiCard icon={CheckCircle2} label="Atividades Executadas" value={summary.sent} />
            <KpiCard icon={MessageSquare} label="Respostas" value={summary.replied} />
            <KpiCard icon={Calendar} label="Reuniões Agendadas" value={summary.meetings} />
            <KpiCard icon={TrendingUp} label="Taxa de Conversão" value={summary.conversionRate} isPercent />
            <KpiCard icon={Users} label="Leads Ativos" value={enrollments.active} />
          </>
        ) : (
          <>
            <KpiCard icon={Send} label="Enviados" value={summary.sent} />
            <KpiCard icon={Mail} label="Abertos" value={summary.opened} rate={summary.openRate} />
            <KpiCard icon={MessageSquare} label="Respondidos" value={summary.replied} rate={summary.replyRate} />
            <KpiCard icon={TrendingDown} label="Bounce" value={summary.bounced} rate={summary.bounceRate} />
            <KpiCard icon={Users} label="Reuniões" value={summary.meetings} rate={summary.conversionRate} rateLabel="conversão" />
          </>
        )}
      </div>

      {/* Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {isStandard ? 'Progresso por Etapa' : 'Taxas por Etapa'}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isStandard ? <StepProgressChart steps={steps} /> : <StepRatesBarChart steps={steps} />}
        </CardContent>
      </Card>

      {/* A/B Test Dashboard — only for auto_email */}
      {!isStandard && abStepIds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Testes A/B</CardTitle>
          </CardHeader>
          <CardContent>
            <AbTestDashboard stepIds={abStepIds} />
          </CardContent>
        </Card>
      )}

      {/* Enrollments donut + Step table */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Enrollments ({enrollments.total})</CardTitle>
          </CardHeader>
          <CardContent>
            {donutData.length === 0 ? (
              <div className="flex h-64 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                Nenhum enrollment no período.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={donutData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {donutData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'var(--popover)',
                      border: '1px solid var(--border)',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend
                    verticalAlign="bottom"
                    iconType="circle"
                    formatter={(value: string) => (
                      <span className="text-xs text-[var(--foreground)]">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Detalhes por Etapa</CardTitle>
          </CardHeader>
          <CardContent>
            <StepPerformanceTable steps={steps} cadenceType={cadenceType} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  rate,
  rateLabel,
  isPercent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  rate?: number;
  rateLabel?: string;
  isPercent?: boolean;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 pt-6">
        <div className="rounded-lg bg-[var(--muted)] p-2">
          <Icon className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        </div>
        <div>
          <p className="text-2xl font-bold">{value}{isPercent ? '%' : ''}</p>
          <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            {label}
            {rate !== undefined && ` · ${rate}% ${rateLabel ?? ''}`}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
