'use client';

import { Target } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card';

import type { GoalData } from '../types/activity-analytics.types';

interface GoalAchievementCardProps {
  goal: GoalData;
}

function getGoalColor(percentage: number): string {
  if (percentage >= 80) return 'bg-green-500';
  if (percentage >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

function getGoalTextColor(percentage: number): string {
  if (percentage >= 80) return 'text-green-600 dark:text-green-400';
  if (percentage >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

export function GoalAchievementCard({ goal }: GoalAchievementCardProps) {
  const barColor = getGoalColor(goal.percentage);
  const textColor = getGoalTextColor(goal.percentage);
  const barWidth = Math.min(goal.percentage, 100);

  // Weekend (BRT): no daily goal. Show the count done (if any) without the
  // red "0% da meta" pressure — consistent with business-day pacing elsewhere.
  if (goal.isWeekend) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Meta de Atividades Hoje
          </CardTitle>
          <Target className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold text-[var(--muted-foreground)]">{goal.actual}</span>
            <span className="text-sm text-[var(--muted-foreground)]">atividades</span>
          </div>
          <p className="text-xs font-medium text-[var(--muted-foreground)]">
            Sem meta hoje — fim de semana
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          Meta de Atividades Hoje
        </CardTitle>
        <Target className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-baseline gap-2">
          <span className={`text-2xl font-bold ${textColor}`}>{goal.actual}</span>
          <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">/ {goal.target}</span>
        </div>

        <div className="h-2 w-full rounded-full bg-[var(--muted)]">
          <div
            className={`h-full rounded-full ${barColor} transition-all`}
            style={{ width: `${barWidth}%` }}
          />
        </div>

        <p className={`text-xs font-medium ${textColor}`}>
          {goal.percentage}% da meta
        </p>
      </CardContent>
    </Card>
  );
}
