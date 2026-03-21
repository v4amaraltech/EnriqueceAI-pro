'use client';

import { Phone, User } from 'lucide-react';

import { Badge } from '@/shared/components/ui/badge';

import type { PendingCallLead } from '../actions/fetch-pending-calls';

function formatTimeSince(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 60) return `${diffMinutes}min`;
  if (diffHours < 24) return `${diffHours}h`;
  return `${diffDays}d`;
}

interface PendingCallLeadCardProps {
  lead: PendingCallLead;
  selected: boolean;
  onToggle: (enrollmentId: string) => void;
}

export function PendingCallLeadCard({ lead, selected, onToggle }: PendingCallLeadCardProps) {
  const timeSince = formatTimeSince(lead.nextStepDue);

  return (
    <button
      type="button"
      onClick={() => onToggle(lead.enrollmentId)}
      className={`flex shrink-0 items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
        selected
          ? 'border-[var(--primary)] bg-[var(--primary)]/5'
          : 'border-[var(--border)] bg-[var(--card)] hover:bg-[var(--accent)]/50'
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        readOnly
        className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
      />
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted)]">
        <User className="h-4 w-4 text-[var(--muted-foreground)] dark:text-[var(--foreground)]" />
      </div>
      <span className="max-w-[120px] truncate text-sm font-medium">{lead.leadName}</span>
      <Badge variant="outline" className="gap-1 text-xs">
        <Phone className="h-3 w-3" />
        {timeSince}
      </Badge>
    </button>
  );
}
