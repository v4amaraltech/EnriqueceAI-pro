'use client';

import { Activity, Calendar, Target, TrendingUp } from 'lucide-react';

import { MetricCard } from '@/features/dashboard/components/MetricCard';
import { AnalyticsFilters } from '@/shared/components/AnalyticsFilters';
import { DrilldownDrawer } from '@/shared/components/drilldown/DrilldownDrawer';
import { useDateRange } from '@/shared/hooks/useDateRange';
import { useDrilldown } from '@/shared/hooks/useDrilldown';
import { calculateDelta } from '@/shared/utils/comparison';

import type { ActivityAnalyticsData } from '../types/activity-analytics.types';
import type { OrgMember } from '../types/shared';
import { ActivityTypeDonutChart } from './ActivityTypeDonutChart';
import { ChannelVolumeChart } from './ChannelVolumeChart';
import { DailyActivityTrendChart } from './DailyActivityTrendChart';
import { GoalAchievementCard } from './GoalAchievementCard';

interface ActivityAnalyticsViewProps {
  data: ActivityAnalyticsData;
  members: OrgMember[];
  hideFilters?: boolean;
  previousData?: ActivityAnalyticsData;
}

export function ActivityAnalyticsView({ data, members, hideFilters, previousData }: ActivityAnalyticsViewProps) {
  const { from, to } = useDateRange('/statistics/activities');
  const drilldown = useDrilldown();
  const prevKpis = previousData?.kpis;
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Atividades</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Análise de volume e performance de atividades.
          </p>
        </div>
        {!hideFilters && (
          <AnalyticsFilters
            basePath="/statistics/activities"
            members={members}
          />
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className="cursor-pointer transition-shadow hover:shadow-md rounded-lg"
          onClick={() => drilldown.open('activity_total', { from, to })}
        >
          <MetricCard
            title="Total Atividades"
            value={data.kpis.totalActivities}
            icon={Activity}
            description="no período selecionado"
            delta={prevKpis ? calculateDelta(data.kpis.totalActivities, prevKpis.totalActivities) : undefined}
          />
        </div>
        <div
          className="cursor-pointer transition-shadow hover:shadow-md rounded-lg"
          onClick={() => drilldown.open('activity_today', { from, to })}
        >
          <MetricCard
            title="Atividades Hoje"
            value={data.kpis.activitiesToday}
            icon={Calendar}
            description="realizadas hoje"
          />
        </div>
        <MetricCard
          title="Média/Dia"
          value={data.kpis.avgPerDay}
          icon={TrendingUp}
          description="atividades por dia"
          delta={prevKpis ? calculateDelta(data.kpis.avgPerDay, prevKpis.avgPerDay) : undefined}
        />
        <MetricCard
          title="Meta Atingida"
          value={`${data.kpis.goalAchievement}%`}
          icon={Target}
          description="da meta diária média"
          delta={prevKpis ? calculateDelta(data.kpis.goalAchievement, prevKpis.goalAchievement) : undefined}
        />
      </div>

      {/* Charts grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Volume por Canal</h2>
          <ChannelVolumeChart data={data.channelVolume} />
        </div>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
          <h2 className="mb-4 text-lg font-semibold">Distribuição por Tipo</h2>
          <ActivityTypeDonutChart data={data.activityTypes} />
        </div>
      </div>

      {/* Daily trend (full width) */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="mb-4 text-lg font-semibold">Tendência Diária</h2>
        <DailyActivityTrendChart data={data.dailyTrend} />
      </div>

      {/* Goal section */}
      <div className="grid gap-4 lg:grid-cols-3">
        <GoalAchievementCard goal={data.goal} />
      </div>

      <DrilldownDrawer {...drilldown} />
    </div>
  );
}
