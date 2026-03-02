'use client';

import { Mail, MousePointerClick, Reply, Send } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';

import type { EmailAnalyticsData } from '../types/email-analytics.types';
import { BounceRateTrendChart } from './BounceRateTrendChart';
import { ConversionFunnelChart } from './ConversionFunnelChart';
import { DailyEmailTrendChart } from './DailyEmailTrendChart';

interface EmailAnalyticsViewProps {
  data: EmailAnalyticsData;
}

export function EmailAnalyticsView({ data }: EmailAnalyticsViewProps) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">E-mails</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Métricas de envio, abertura, cliques e respostas de e-mails.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Emails Enviados"
          value={data.totalSent.toLocaleString('pt-BR')}
          icon={Send}
          description={`${data.totalBounced} bounces`}
        />
        <MetricCard
          title="Taxa de Abertura"
          value={`${data.openRate}%`}
          icon={Mail}
          description={`${data.totalOpened.toLocaleString('pt-BR')} abertos`}
        />
        <MetricCard
          title="Taxa de Clique"
          value={`${data.clickRate}%`}
          icon={MousePointerClick}
          description={`${data.totalClicked.toLocaleString('pt-BR')} cliques`}
        />
        <MetricCard
          title="Taxa de Resposta"
          value={`${data.replyRate}%`}
          icon={Reply}
          description={`${data.totalReplied.toLocaleString('pt-BR')} respostas`}
        />
      </div>

      {/* Funnel */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Funil de E-mails</h2>
        <ConversionFunnelChart stages={data.funnel} />
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Tendência Diária</h2>
          <DailyEmailTrendChart data={data.dailyTrend} />
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Tendência de Bounces</h2>
          <BounceRateTrendChart data={data.bounceTrend} />
        </div>
      </div>
    </div>
  );
}
