import { PublicCard } from '@/features/closer-calendar/PublicCard';
import { CLOSER_CALENDAR_COPY } from '@/features/closer-calendar/copy';
import { describeCloserCalendarInvite } from '@/features/closer-calendar/public-flow';

const BLOCKED: Record<string, string> = {
  invalid: CLOSER_CALENDAR_COPY.invalidLink,
  expired: CLOSER_CALENDAR_COPY.expiredLink,
  used: CLOSER_CALENDAR_COPY.usedLink,
  revoked: CLOSER_CALENDAR_COPY.revokedLink,
  unavailable: CLOSER_CALENDAR_COPY.unavailableLink,
  error: CLOSER_CALENDAR_COPY.errorBody,
};

export default async function ConectarAgendaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await describeCloserCalendarInvite(token);
  if (view.status !== 'ready') {
    return (
      <PublicCard title={CLOSER_CALENDAR_COPY.pageTitle}>
        <p>{BLOCKED[view.status] ?? CLOSER_CALENDAR_COPY.invalidLink}</p>
      </PublicCard>
    );
  }

  return (
    <PublicCard title={CLOSER_CALENDAR_COPY.pageTitle}>
      <p>Olá, {view.name}.</p>
      <p>{CLOSER_CALENDAR_COPY.pageIntro}</p>
      <p>{CLOSER_CALENDAR_COPY.pageScope}</p>
      <a
        href={`/api/closer-calendar/start?token=${encodeURIComponent(token)}`}
        className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
      >
        {CLOSER_CALENDAR_COPY.connectButton}
      </a>
    </PublicCard>
  );
}
