'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';

import { inviteCloserCalendar, revokeCloserCalendarInvite } from './actions';
import { CLOSER_CALENDAR_COPY } from './copy';
import type { CloserCalendarCard } from './status';

export function CloserCalendarControls({
  closerId,
  card,
}: {
  closerId: string;
  card?: CloserCalendarCard;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const status = card?.status ?? 'none';
  const label = card?.label ?? 'Agenda não conectada';

  function invite() {
    startTransition(async () => {
      const result = await inviteCloserCalendar(closerId);
      if (result.success) {
        toast.success(CLOSER_CALENDAR_COPY.sent);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function revoke() {
    startTransition(async () => {
      const result = await revokeCloserCalendarInvite(closerId);
      if (result.success) {
        toast.success(CLOSER_CALENDAR_COPY.revoked);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const inviteLabel = status === 'none' || status === 'expired' || status === 'error'
    ? CLOSER_CALENDAR_COPY.inviteButton
    : CLOSER_CALENDAR_COPY.resendButton;

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agenda Google: {label}
        {status === 'connected' && card?.calendarEmail ? ` (${card.calendarEmail})` : ''}
      </p>
      {card?.warning ? (
        <p className="text-xs text-destructive">{card.warning}</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={invite} disabled={pending}>
          {inviteLabel}
        </Button>
        {status === 'pending' ? (
          <Button type="button" size="sm" variant="ghost" onClick={revoke} disabled={pending}>
            {CLOSER_CALENDAR_COPY.revokeButton}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
