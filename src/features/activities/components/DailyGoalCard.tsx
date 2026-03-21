'use client';

import Link from 'next/link';

import { Rocket, Trophy } from 'lucide-react';

interface DailyGoalCardProps {
  target: number;
  completed: number;
}

export function DailyGoalCard({ target, completed }: DailyGoalCardProps) {
  const isAchieved = completed >= target;

  return (
    <div className="rounded-lg border bg-[var(--card)] p-5">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
          <Trophy className="h-5 w-5 text-amber-500" />
        </div>
        <div className="flex-1">
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Objetivo Diário</p>
          <p className="text-2xl font-bold">
            {target}
          </p>
        </div>
      </div>
      <div className="mt-3">
        {isAchieved ? (
          <p className="text-sm text-emerald-500 font-medium">
            Meta atingida! Continue assim.
          </p>
        ) : (
          <p className="text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
            Faltam <span className="font-semibold text-[var(--foreground)]">{target - completed}</span> atividades para atingir sua meta.
          </p>
        )}
      </div>
      <Link
        href="/leads"
        className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--primary)] hover:underline"
      >
        <Rocket className="h-3.5 w-3.5" />
        Iniciar novas prospecções
      </Link>
    </div>
  );
}
