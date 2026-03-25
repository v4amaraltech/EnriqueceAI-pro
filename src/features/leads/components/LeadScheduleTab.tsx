'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Calendar, Video } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { getCalendarAuthUrl } from '@/features/integrations/actions/manage-calendar';
import { scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';

interface LeadScheduleTabProps {
  leadId: string;
  leadEmail: string | null;
  companyName: string | null;
}

export function LeadScheduleTab({ leadId, leadEmail, companyName }: LeadScheduleTabProps) {
  const router = useRouter();
  const [meetingDate, setMeetingDate] = useState('');
  const [meetingTime, setMeetingTime] = useState('09:00');
  const [meetingDuration, setMeetingDuration] = useState('30');
  const [meetingTitle, setMeetingTitle] = useState('');
  const [meetingAttendee, setMeetingAttendee] = useState('');
  const [meetingMeetLink, setMeetingMeetLink] = useState(true);
  const [isMeetingPending, startMeetingTransition] = useTransition();

  const defaultTitle = `Reunião com ${companyName ?? 'Lead'}`;

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agendar Reunião
      </h4>

      <div>
        <Label className="text-xs">Título</Label>
        <Input
          value={meetingTitle}
          onChange={(e) => setMeetingTitle(e.target.value)}
          placeholder={defaultTitle}
          className="mt-1"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={meetingDate}
            onChange={(e) => setMeetingDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Hora</Label>
          <Input
            type="time"
            value={meetingTime}
            onChange={(e) => setMeetingTime(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Duração</Label>
        <select
          className="mt-1 flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm"
          value={meetingDuration}
          onChange={(e) => setMeetingDuration(e.target.value)}
        >
          <option value="15">15 min</option>
          <option value="30">30 min</option>
          <option value="45">45 min</option>
          <option value="60">1 hora</option>
          <option value="90">1h30</option>
        </select>
      </div>

      <div>
        <Label className="text-xs">Email do closer (participante)</Label>
        <Input
          type="email"
          value={meetingAttendee}
          onChange={(e) => setMeetingAttendee(e.target.value)}
          placeholder="closer@empresa.com"
          className="mt-1"
        />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={meetingMeetLink}
          onChange={(e) => setMeetingMeetLink(e.target.checked)}
          className="rounded"
        />
        <Video className="h-3.5 w-3.5" />
        Gerar link do Google Meet
      </label>

      <Button
        className="w-full"
        disabled={!meetingDate || !meetingTime || isMeetingPending}
        onClick={() => {
          const startDateTime = new Date(`${meetingDate}T${meetingTime}:00`);
          const endDateTime = new Date(startDateTime.getTime() + parseInt(meetingDuration, 10) * 60 * 1000);
          const title = meetingTitle || defaultTitle;

          startMeetingTransition(async () => {
            const result = await scheduleMeeting(leadId, {
              title,
              startTime: startDateTime.toISOString(),
              endTime: endDateTime.toISOString(),
              attendeeEmails: (meetingAttendee || leadEmail)
                ? (meetingAttendee || leadEmail || '').split(',').map((e: string) => e.trim()).filter(Boolean)
                : undefined,
              generateMeetLink: meetingMeetLink,
            });

            if (result.success) {
              const meetInfo = result.data.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
              toast.success(`Reunião agendada!${meetInfo}`);
              setMeetingDate('');
              setMeetingTitle('');
              router.refresh();
            } else if (result.code === 'GCAL_TOKEN_EXPIRED') {
              toast.info('Reconectando ao Google Calendar...');
              const authResult = await getCalendarAuthUrl();
              if (authResult.success) {
                window.location.href = authResult.data.url;
              } else {
                toast.error('Não foi possível reconectar. Vá em Configurações > Integrações.');
              }
            } else {
              toast.error(result.error);
            }
          });
        }}
      >
        <Calendar className="mr-2 h-4 w-4" />
        {isMeetingPending ? 'Agendando...' : 'Agendar Reunião'}
      </Button>
    </div>
  );
}
