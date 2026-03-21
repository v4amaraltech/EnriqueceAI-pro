'use client';

import { Activity, CheckCircle2 } from 'lucide-react';

interface ProgressCardProps {
  completed: number;
  total: number;
}

export function ProgressCard({ completed, total }: ProgressCardProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="rounded-lg border bg-[var(--card)] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
          <Activity className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Meu Progresso Hoje</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-bold">
              {completed} / {total}
            </span>
            <span className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">ATIVIDADES</span>
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--muted)]">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${Math.min(percentage, 100)}%` }}
          />
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
          <span>{completed} finalizado{completed !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
          <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
          <span>{total - completed} pendente{total - completed !== 1 ? 's' : ''}</span>
        </div>
      </div>
    </div>
  );
}
