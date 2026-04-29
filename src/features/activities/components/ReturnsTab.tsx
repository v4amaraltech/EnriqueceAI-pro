'use client';

import { useMemo, useState } from 'react';

import { CheckCircle2 } from 'lucide-react';

import type { PendingActivity } from '../types';
import { ActivityPagination } from './ActivityPagination';
import { ActivityRow } from './ActivityRow';

interface ReturnsTabProps {
  returns: PendingActivity[];
  onExecute: (activity: PendingActivity) => void;
  onIgnore: (activity: PendingActivity) => void;
  onViewLead: (leadId: string) => void;
  onLeadWon: (activity: PendingActivity) => void;
  onLeadLost: (activity: PendingActivity) => void;
}

export function ReturnsTab({ returns, onExecute, onIgnore, onViewLead, onLeadWon, onLeadLost }: ReturnsTabProps) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const sorted = useMemo(
    () => [...returns].sort((a, b) => new Date(a.nextStepDue).getTime() - new Date(b.nextStepDue).getTime()),
    [returns],
  );

  const paginated = useMemo(() => {
    const start = (page - 1) * perPage;
    return sorted.slice(start, start + perPage);
  }, [sorted, page, perPage]);

  if (returns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-4 py-16 text-center">
        <CheckCircle2 className="h-10 w-10 text-emerald-500/50 mb-3" />
        <h3 className="text-sm font-medium text-[var(--foreground)]">
          Nenhum retorno pendente
        </h3>
        <p className="mt-1 text-xs text-[var(--muted-foreground)] max-w-[280px]">
          Retornos agendados durante a execução de atividades aparecerão aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {paginated.map((activity) => (
        <ActivityRow
          key={`${activity.enrollmentId}:${activity.stepId}`}
          activity={activity}
          onExecute={() => onExecute(activity)}
          onIgnore={() => onIgnore(activity)}
          onViewLead={() => onViewLead(activity.lead.id)}
          onLeadWon={() => onLeadWon(activity)}
          onLeadLost={() => onLeadLost(activity)}
        />
      ))}
      <ActivityPagination
        total={sorted.length}
        page={page}
        perPage={perPage}
        onPageChange={setPage}
        onPerPageChange={(v) => { setPerPage(v); setPage(1); }}
      />
    </div>
  );
}
