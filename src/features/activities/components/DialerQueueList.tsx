'use client';

import { Check, Phone, SkipForward } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';
import { cn } from '@/lib/utils';

import type { DialerQueueItem } from '../actions/fetch-dialer-queue';

export type DialerItemStatus = 'pending' | 'active' | 'completed' | 'skipped';

interface DialerQueueListProps {
  items: DialerQueueItem[];
  itemStatuses: Map<string, DialerItemStatus>;
  currentIndex: number;
  isActive: boolean;
  onSelect: (index: number) => void;
}

function LeadAvatar({ name, status }: { name: string; status: DialerItemStatus }) {
  if (status === 'completed') {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
      </div>
    );
  }

  if (status === 'skipped') {
    return (
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-800">
        <SkipForward className="h-4 w-4 text-gray-400 dark:text-gray-300" />
      </div>
    );
  }

  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase();

  return (
    <div className={cn(
      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium',
      status === 'active'
        ? 'bg-[var(--primary)] text-white'
        : 'bg-[var(--muted)] text-[var(--muted-foreground)] dark:text-[var(--foreground)]',
    )}>
      {initials}
    </div>
  );
}

const statusBadge: Record<DialerItemStatus, { label: string; className: string } | null> = {
  pending: null,
  active: { label: 'Ativo', className: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300' },
  completed: { label: 'Concluido', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300' },
  skipped: { label: 'Pulado', className: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-300' },
};

export function DialerQueueList({ items, itemStatuses, currentIndex, isActive, onSelect }: DialerQueueListProps) {
  return (
    <div className="space-y-1.5 overflow-y-auto">
      {items.map((item, index) => {
        const status = itemStatuses.get(item.enrollmentId) ?? (isActive && index === currentIndex ? 'active' : 'pending');
        const badge = statusBadge[status];
        const isDone = status === 'completed' || status === 'skipped';
        const isCurrentActive = isActive && index === currentIndex;

        return (
          <button
            key={item.enrollmentId}
            type="button"
            onClick={() => {
              if (!isDone) onSelect(index);
            }}
            disabled={isDone}
            className={cn(
              'flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors',
              isCurrentActive
                ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                : isDone
                  ? 'border-[var(--border)] opacity-50'
                  : 'border-[var(--border)] hover:bg-[var(--accent)]/50',
            )}
          >
            <div className="flex items-center gap-3 min-w-0">
              <LeadAvatar name={item.leadName} status={status} />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{item.leadName}</p>
                <div className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
                  {item.phone ? (
                    <>
                      <Phone className="h-3 w-3" />
                      <span className="truncate">{item.phone}</span>
                    </>
                  ) : (
                    <span className="italic">Sem telefone</span>
                  )}
                </div>
              </div>
            </div>
            {badge && (
              <Badge variant="secondary" className={cn('ml-2 shrink-0 text-xs', badge.className)}>
                {badge.label}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
