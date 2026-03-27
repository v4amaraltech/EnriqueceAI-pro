'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { listClosers, type CloserRow } from '@/features/settings-prospecting/actions/closers-crud';

import { getCalendarAuthUrl } from '../actions/manage-calendar';
import { scheduleMeeting, getLoggedUserEmail } from '../actions/schedule-meeting';

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadEmail?: string | null;
  leadName?: string | null;
}

export function ScheduleMeetingModal({
  open,
  onOpenChange,
  leadId,
  leadEmail,
  leadName,
}: ScheduleMeetingModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState(`V4 Company + ${leadName ?? 'Lead'}`);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [duration, setDuration] = useState('30');
  const [attendeeEmails, setAttendeeEmails] = useState(leadEmail ?? '');
  const [generateMeetLink, setGenerateMeetLink] = useState(true);

  // Closer selection
  const [closers, setClosers] = useState<CloserRow[]>([]);
  const [closersLoaded, setClosersLoaded] = useState(false);
  const [selectedCloserId, setSelectedCloserId] = useState('');
  const [sdrEmail, setSdrEmail] = useState('');

  function buildAttendees(closerEmail?: string, currentSdrEmail?: string) {
    const emails = [
      leadEmail,
      closerEmail,
      currentSdrEmail ?? sdrEmail,
    ].filter((e): e is string => !!e && e.trim() !== '');
    return [...new Set(emails)].join(', ');
  }

  useEffect(() => {
    if (open && !closersLoaded) {
      Promise.all([listClosers(), getLoggedUserEmail()]).then(([closersResult, emailResult]) => {
        if (closersResult.success) setClosers(closersResult.data);
        setClosersLoaded(true);
        const userEmail = emailResult.success ? emailResult.data : '';
        setSdrEmail(userEmail);
        setAttendeeEmails(buildAttendees(undefined, userEmail));
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closersLoaded]);

  function handleSubmit() {
    if (!date || !startTime) {
      toast.error('Preencha a data e hora');
      return;
    }

    const startDateTime = new Date(`${date}T${startTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + parseInt(duration, 10) * 60 * 1000);

    startTransition(async () => {
      const emails = attendeeEmails
        .split(',')
        .map((e) => e.trim())
        .filter(Boolean);

      const result = await scheduleMeeting(leadId, {
        title,
        description: description || undefined,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        attendeeEmails: emails.length > 0 ? emails : undefined,
        generateMeetLink,
        closerId: selectedCloserId || undefined,
      });

      if (result.success) {
        const meetInfo = result.data.meetLink
          ? ` | Meet: ${result.data.meetLink}`
          : '';
        toast.success(`Reunião agendada!${meetInfo}`);
        setSelectedCloserId('');
        onOpenChange(false);
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
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Agendar Reunião
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="meeting-title">Título</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Reunião de apresentação"
            />
          </div>

          <div>
            <Label htmlFor="meeting-description">Descrição (opcional)</Label>
            <Input
              id="meeting-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Detalhes da reunião"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="meeting-date">Data</Label>
              <Input
                id="meeting-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="meeting-time">Hora</Label>
              <Input
                id="meeting-time"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="meeting-duration">Duração (minutos)</Label>
            <select
              id="meeting-duration"
              className="flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            >
              <option value="15">15 min</option>
              <option value="30">30 min</option>
              <option value="45">45 min</option>
              <option value="60">1 hora</option>
              <option value="90">1h30</option>
            </select>
          </div>

          <div>
            <Label htmlFor="meeting-closer">Closer (participante)</Label>
            <select
              id="meeting-closer"
              className="flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
              value={selectedCloserId}
              disabled={!closersLoaded}
              onChange={(e) => {
                const closerId = e.target.value;
                setSelectedCloserId(closerId);
                const closer = closers.find((c) => c.id === closerId);
                setAttendeeEmails(buildAttendees(closer?.email));
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
            <Label htmlFor="meeting-email">Emails dos participantes</Label>
            <Input
              id="meeting-email"
              type="text"
              value={attendeeEmails}
              onChange={(e) => setAttendeeEmails(e.target.value)}
              placeholder="lead@exemplo.com, sdr@empresa.com"
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)] dark:text-[var(--foreground)]">
              Separe múltiplos emails com vírgula
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={generateMeetLink}
              onChange={(e) => setGenerateMeetLink(e.target.checked)}
              className="rounded"
            />
            <Video className="h-4 w-4" />
            Gerar link do Google Meet
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            <Calendar className="mr-2 h-4 w-4" />
            {isPending ? 'Agendando...' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
