'use client';

import { useState } from 'react';

import { Rocket, Trophy } from 'lucide-react';

import { StartProspectingDialog } from './StartProspectingDialog';

interface DailyGoalCardProps {
  target: number;
  completed: number;
  availableLeadIds?: string[];
}

export function DailyGoalCard({ target, completed, availableLeadIds = [] }: DailyGoalCardProps) {
  const isAchieved = completed >= target;
  const [dialogOpen, setDialogOpen] = useState(false);
  const remaining = Math.max(0, target - completed);

  return (
    <div className="rounded-lg border bg-[var(--card)] p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
          <Trophy className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <p className="text-sm text-[var(--muted-foreground)]">Objetivo Diário</p>
          <p className="text-3xl font-bold">{target}</p>
        </div>
      </div>

      <div className="mb-4">
        {isAchieved ? (
          <p className="text-sm text-emerald-500 font-medium">
            Meta atingida! Continue assim.
          </p>
        ) : target > 0 ? (
          <p className="text-sm text-[var(--muted-foreground)]">
            Faltam <span className="font-semibold text-[var(--foreground)]">{remaining}</span> atividades para atingir sua meta.
          </p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)]">
            Para alcançar seu objetivo diário, adicione atividades à lista iniciando novos leads.
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        disabled={availableLeadIds.length === 0}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-[#E53935] hover:underline disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
      >
        <Rocket className="h-3.5 w-3.5" />
        Iniciar novas prospecções
      </button>
      <StartProspectingDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        leadIds={availableLeadIds}
        remaining={remaining}
      />
    </div>
  );
}
