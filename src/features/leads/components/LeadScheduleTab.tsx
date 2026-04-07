'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Calendar, Clock, Video } from 'lucide-react';

import { Button } from '@/shared/components/ui/button';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';

import { Textarea } from '@/shared/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/components/ui/select';

import { getCalendarAuthUrl } from '@/features/integrations/actions/manage-calendar';
import { scheduleMeeting, getLoggedUserEmail, checkCalendarConnected } from '@/features/integrations/actions/schedule-meeting';
import { scheduleActivity } from '@/features/activities/actions/schedule-activity';
import { listClosers, type CloserRow } from '@/features/settings-prospecting/actions/closers-crud';

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

  // Schedule activity state
  const [activityChannel, setActivityChannel] = useState<'phone' | 'whatsapp' | 'email' | 'linkedin' | 'research'>('phone');
  const [activityDate, setActivityDate] = useState('');
  const [activityTime, setActivityTime] = useState('09:00');
  const [activityNotes, setActivityNotes] = useState('');
  const [isActivityPending, startActivityTransition] = useTransition();

  // Closer selection
  const [closers, setClosers] = useState<CloserRow[]>([]);
  const [closersLoaded, setClosersLoaded] = useState(false);
  const [selectedCloserId, setSelectedCloserId] = useState('');
  const [sdrEmail, setSdrEmail] = useState('');
  const [calendarConnected, setCalendarConnected] = useState<boolean | null>(null);

  // Build attendee list from available emails
  function buildAttendees(closerEmail?: string, currentSdrEmail?: string) {
    const emails = [
      leadEmail,
      closerEmail,
      currentSdrEmail ?? sdrEmail,
    ].filter((e): e is string => !!e && e.trim() !== '');
    // Deduplicate
    return [...new Set(emails)].join(', ');
  }

  useEffect(() => {
    Promise.all([listClosers(), getLoggedUserEmail(), checkCalendarConnected()]).then(([closersResult, emailResult, calResult]) => {
      if (closersResult.success) setClosers(closersResult.data);
      setClosersLoaded(true);
      const userEmail = emailResult.success ? emailResult.data : '';
      setSdrEmail(userEmail);
      setMeetingAttendee(buildAttendees(undefined, userEmail));
      if (calResult.success) setCalendarConnected(calResult.data);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const defaultTitle = `V4 Company + ${companyName ?? 'Lead'}`;

  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agendar Reunião
      </h4>

      {calendarConnected === false && (
        <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-800 dark:text-amber-200">
          Google Calendar não conectado. Conecte em <strong>Integrações</strong> para agendar reuniões.
        </div>
      )}

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
        <Label className="text-xs">Closer (participante)</Label>
        <select
          className="mt-1 flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1 text-sm"
          value={selectedCloserId}
          disabled={!closersLoaded}
          onChange={(e) => {
            const closerId = e.target.value;
            setSelectedCloserId(closerId);
            const closer = closers.find((c) => c.id === closerId);
            setMeetingAttendee(buildAttendees(closer?.email));
          }}
        >
          {!closersLoaded ? (
            <option value="">Carregando closers...</option>
          ) : closers.length === 0 ? (
            <option value="">Nenhum closer cadastrado</option>
          ) : (
            <>
              <option value="">Selecione um closer...</option>
              {closers.map((closer) => (
                <option key={closer.id} value={closer.id}>
                  {closer.name} ({closer.email})
                </option>
              ))}
            </>
          )}
        </select>
      </div>

      <div>
        <Label className="text-xs">Emails dos participantes</Label>
        <Input
          value={meetingAttendee}
          onChange={(e) => setMeetingAttendee(e.target.value)}
          placeholder="lead@exemplo.com, sdr@empresa.com"
          className="mt-1"
        />
        <p className="text-[10px] text-[var(--muted-foreground)] mt-1">Separe múltiplos emails com vírgula</p>
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
              closerId: selectedCloserId || undefined,
            });

            if (result.success) {
              const meetInfo = result.data.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
              toast.success(`Reunião agendada!${meetInfo}`);
              setMeetingDate('');
              setMeetingTitle('');
              setSelectedCloserId('');
              setMeetingAttendee('');
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

      {/* Separator */}
      <div className="border-t border-[var(--border)] my-2" />

      {/* Schedule Activity (non-meeting) */}
      <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
        Agendar Atividade
      </h4>

      <div>
        <Label className="text-xs">Tipo de atividade</Label>
        <Select value={activityChannel} onValueChange={(v) => setActivityChannel(v as typeof activityChannel)}>
          <SelectTrigger className="mt-1 w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="phone">Ligação</SelectItem>
            <SelectItem value="whatsapp">WhatsApp</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="linkedin">LinkedIn</SelectItem>
            <SelectItem value="research">Pesquisa</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Data</Label>
          <Input
            type="date"
            value={activityDate}
            onChange={(e) => setActivityDate(e.target.value)}
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-xs">Hora</Label>
          <Input
            type="time"
            value={activityTime}
            onChange={(e) => setActivityTime(e.target.value)}
            className="mt-1"
          />
        </div>
      </div>

      <div>
        <Label className="text-xs">Observações</Label>
        <Textarea
          value={activityNotes}
          onChange={(e) => setActivityNotes(e.target.value)}
          placeholder="Ex: Retornar para verificar interesse..."
          className="mt-1 min-h-[60px]"
        />
      </div>

      <Button
        className="w-full"
        variant="outline"
        disabled={!activityDate || !activityTime || isActivityPending}
        onClick={() => {
          const scheduledAt = new Date(`${activityDate}T${activityTime}:00`).toISOString();

          startActivityTransition(async () => {
            const result = await scheduleActivity({
              leadId,
              channel: activityChannel,
              scheduledAt,
              notes: activityNotes || undefined,
              completeEnrollments: false,
            });

            if (result.success) {
              toast.success('Atividade agendada!');
              setActivityDate('');
              setActivityNotes('');
              router.refresh();
            } else {
              toast.error(result.error);
            }
          });
        }}
      >
        <Clock className="mr-2 h-4 w-4" />
        {isActivityPending ? 'Agendando...' : 'Agendar Atividade'}
      </Button>
    </div>
  );
}
