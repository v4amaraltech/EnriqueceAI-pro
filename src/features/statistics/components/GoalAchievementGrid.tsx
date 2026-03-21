'use client';

import type { SdrGoalEntry } from '../types/team-analytics.types';

interface GoalAchievementGridProps {
  goals: SdrGoalEntry[];
}

function getGoalColor(percentage: number): { bar: string; text: string } {
  if (percentage >= 100) return { bar: 'bg-green-500', text: 'text-green-600 dark:text-green-400' };
  if (percentage >= 70) return { bar: 'bg-yellow-500', text: 'text-yellow-600 dark:text-yellow-400' };
  return { bar: 'bg-red-500', text: 'text-red-600 dark:text-red-400' };
}

export function GoalAchievementGrid({ goals }: GoalAchievementGridProps) {
  if (goals.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhum SDR encontrado.
      </div>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {goals.map((entry) => {
        const colors = getGoalColor(entry.percentage);
        const barWidth = Math.min(entry.percentage, 100);

        return (
          <div
            key={entry.userId}
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-3"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium">{entry.userName}</span>
              <span className={`text-sm font-bold ${colors.text}`}>{entry.percentage}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[var(--muted)]">
              <div
                className={`h-full rounded-full ${colors.bar} transition-all`}
                style={{ width: `${barWidth}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              {entry.actual} / {entry.target} atividades
            </p>
          </div>
        );
      })}
    </div>
  );
}
