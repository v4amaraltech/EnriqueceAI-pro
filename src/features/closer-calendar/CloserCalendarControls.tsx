'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { Calendar, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/shared/components/ui/badge';
import { Button } from '@/shared/components/ui/button';

import { inviteCloserCalendar, revokeCloserCalendarInvite } from './actions';
import { CLOSER_CALENDAR_COPY } from './copy';
import type { CloserCalendarCard, CloserCalendarUiStatus } from './status';

const BADGE_TONE = {
  amber: 'border-amber-700/40 bg-amber-500/15 text-amber-950 dark:text-amber-200',
  neutral: 'border-border bg-muted text-foreground',
  green: 'border-emerald-700/40 bg-emerald-500/15 text-emerald-950 dark:text-emerald-200',
} as const;

function badgeFor(status: CloserCalendarUiStatus): { text: string; tone: keyof typeof BADGE_TONE } {
  switch (status) {
    case 'connected':
      return { text: CLOSER_CALENDAR_COPY.badgeConnected, tone: 'green' };
    case 'pending':
      return { text: CLOSER_CALENDAR_COPY.badgePending, tone: 'neutral' };
    case 'expired':
      return { text: CLOSER_CALENDAR_COPY.badgeExpired, tone: 'amber' };
    case 'error':
      return { text: CLOSER_CALENDAR_COPY.badgeError, tone: 'amber' };
    default:
      return { text: CLOSER_CALENDAR_COPY.badgeNone, tone: 'amber' };
  }
}

export function CloserCalendarControls({
  closerId,
  card,
}: {
  closerId: string;
  card?: CloserCalendarCard;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<'invite' | 'revoke' | null>(null);
  const status = card?.status ?? 'none';
  const badge = badgeFor(status);
  const inviteLabel = status === 'pending'
    ? CLOSER_CALENDAR_COPY.resendButton
    : CLOSER_CALENDAR_COPY.inviteButton;
  const inviting = pending && action === 'invite';
  const revoking = pending && action === 'revoke';

  function invite() {
    setAction('invite');
    startTransition(async () => {
      const result = await inviteCloserCalendar(closerId);
      if (result.success) {
        toast.success(CLOSER_CALENDAR_COPY.sent);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setAction(null);
    });
  }

  function revoke() {
    setAction('revoke');
    startTransition(async () => {
      const result = await revokeCloserCalendarInvite(closerId);
      if (result.success) {
        toast.success(CLOSER_CALENDAR_COPY.revoked);
        router.refresh();
      } else {
        toast.error(result.error);
      }
      setAction(null);
    });
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--muted-foreground)]">Agenda Google</span>
        <Badge variant="outline" className={BADGE_TONE[badge.tone]}>
          {badge.text}
        </Badge>
        {status === 'connected' && card?.calendarEmail ? (
          <span className="text-xs text-[var(--foreground)]">{card.calendarEmail}</span>
        ) : null}
      </div>
      {card?.warning ? (
        <p className="text-xs text-destructive">{card.warning}</p>
      ) : null}
      {status === 'connected' ? null : (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={invite}
            disabled={pending}
            aria-busy={inviting}
          >
            {inviting ? <Loader2 className="animate-spin" /> : <Calendar />}
            {inviting ? CLOSER_CALENDAR_COPY.sending : inviteLabel}
          </Button>
          {status === 'pending' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="text-red-700 hover:text-red-700 dark:text-red-300 dark:hover:text-red-300"
              onClick={revoke}
              disabled={pending}
              aria-busy={revoking}
            >
              {revoking ? <Loader2 className="animate-spin" /> : null}
              {revoking ? CLOSER_CALENDAR_COPY.revoking : CLOSER_CALENDAR_COPY.revokeButton}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
