'use client';

import { Activity, CheckCircle2 } from 'lucide-react';

interface ProgressCardProps {
  completed: number;
  total: number;
}

export function ProgressCard({ completed, total }: ProgressCardProps) {
  const pending = total - completed;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-[var(--card)] p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
          <Activity className="h-5 w-5 text-emerald-500" />
        </div>
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">Meu Progresso Hoje</p>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold text-emerald-600">{completed}</span>
            <span className="text-lg text-[var(--muted-foreground)]">/ {total}</span>
            <span className="text-sm font-medium uppercase tracking-wider text-[var(--muted-foreground)]">atividades</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>

      {/* Legend */}
      <div className="mt-3 flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>{completed} finalizado{completed !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
          <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
          <span>{pending} pendente{pending !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
