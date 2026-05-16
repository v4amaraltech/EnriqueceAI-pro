'use client';

import { useState } from 'react';

import { CheckCircle2, Info, Trophy } from 'lucide-react';

import { StartProspectingDialog } from './StartProspectingDialog';

interface ProgressCardProps {
  completed: number;
  total: number;
  target: number;
  availableLeadIds?: string[];
}

export function ProgressCard({ completed, total, target, availableLeadIds = [] }: ProgressCardProps) {
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const isAchieved = target > 0 && completed >= target;
  const remaining = Math.max(0, target - completed);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="rounded-lg border bg-[var(--card)] p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold">Meu progresso hoje</h3>
        <span title="O progresso mostra atividades finalizadas vs pendentes do dia">
          <Info className="h-4 w-4 text-[var(--muted-foreground)] cursor-help" />
        </span>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left: Progress */}
        <div className="flex-1 lg:border-r lg:border-[var(--border)] lg:pr-6">
          {/* KPI */}
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-4xl font-bold text-emerald-600">{completed}</span>
            <span className="text-base text-[var(--muted-foreground)]">/ {total} atividades</span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${Math.min(percentage, 100)}%` }}
            />
          </div>

          {/* Legend */}
          <div className="mt-3 flex items-center gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
              <span>Finalizado</span>
            </div>
            <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
              <div className="h-2 w-2 rounded-full bg-[var(--muted-foreground)]" />
              <span>Pendente</span>
            </div>
          </div>
        </div>

        {/* Right: Daily Goal */}
        <div className="flex items-center gap-4 lg:w-[45%]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
            <Trophy className="h-6 w-6 text-amber-500" />
          </div>
          <div>
            <p className="text-sm font-semibold">Objetivo diário ({target})</p>
            {isAchieved ? (
              <p className="mt-1 text-sm text-emerald-500 font-medium">
                Meta atingida! Continue assim.
              </p>
            ) : target > 0 ? (
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Faltam <span className="font-semibold text-[var(--foreground)]">{remaining}</span> atividades para atingir sua meta.
              </p>
            ) : (
              <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                Para alcançar seu objetivo diário, adicione atividades à lista iniciando novos leads.
              </p>
            )}
          </div>
        </div>
      </div>

      <StartProspectingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leadIds={availableLeadIds}
        remaining={remaining}
      />
    </div>
  );
}
