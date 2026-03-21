'use client';

import { Phone } from 'lucide-react';

interface DialerProgressBarProps {
  completed: number;
  skipped: number;
  total: number;
}

export function DialerProgressBar({ completed, skipped, total }: DialerProgressBarProps) {
  const done = completed + skipped;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-2">
          <Phone className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
          <span className="font-medium">
            {completed} de {total} ligacoes concluidas
          </span>
          {skipped > 0 && (
            <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              ({skipped} pulada{skipped > 1 ? 's' : ''})
            </span>
          )}
        </div>
        <span className="text-[var(--muted-foreground)] dark:text-[var(--foreground)] tabular-nums">{percent}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--muted)]">
        <div
          className="h-full rounded-full bg-[var(--primary)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
