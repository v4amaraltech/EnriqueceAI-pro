'use client';

import { CallStatusIcon } from '@/features/calls/components/CallStatusIcon';

import type { RecentTeamCall } from '../types/call-dashboard.types';
import { formatDuration } from '../types/shared';

interface RecentTeamCallsTableProps {
  calls: RecentTeamCall[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'agora';
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  return `${days}d atrás`;
}

export function RecentTeamCallsTable({ calls }: RecentTeamCallsTableProps) {
  if (calls.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Nenhuma ligação recente.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">SDR</th>
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Destino</th>
            <th className="px-4 py-2 text-left font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Status</th>
            <th className="px-4 py-2 text-right font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Duração</th>
            <th className="px-4 py-2 text-right font-medium text-[var(--muted-foreground)] dark:text-[var(--foreground)]">Quando</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr key={call.id} className="border-b border-[var(--border)]">
              <td className="px-4 py-2">{call.userName}</td>
              <td className="px-4 py-2 font-mono text-xs">{call.destination}</td>
              <td className="px-4 py-2">
                <CallStatusIcon status={call.status} showLabel />
              </td>
              <td className="px-4 py-2 text-right font-mono text-xs">
                {formatDuration(call.durationSeconds)}
              </td>
              <td className="px-4 py-2 text-right text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                {timeAgo(call.startedAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
