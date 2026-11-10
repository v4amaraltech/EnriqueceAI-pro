import { PublicCard } from '@/features/closer-calendar/PublicCard';
import { CLOSER_CALENDAR_COPY } from '@/features/closer-calendar/copy';

const MESSAGE: Record<string, { title: string; body: string }> = {
  ok: { title: CLOSER_CALENDAR_COPY.successTitle, body: CLOSER_CALENDAR_COPY.successBody },
  denied: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.deniedBody },
  mismatch: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.mismatchBody },
  expired: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.expiredLink },
  used: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.usedLink },
  revoked: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.revokedLink },
  unavailable: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.unavailableLink },
  invalid: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.invalidLink },
  error: { title: CLOSER_CALENDAR_COPY.pageTitle, body: CLOSER_CALENDAR_COPY.errorBody },
};

export default async function ConectarAgendaResultadoPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const message = MESSAGE[status ?? ''] ?? MESSAGE.error!;
  return (
    <PublicCard title={message.title}>
      <p>{message.body}</p>
    </PublicCard>
  );
}
