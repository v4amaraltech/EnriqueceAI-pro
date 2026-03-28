'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Calendar as CalendarIcon, Video } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/shared/components/ui/button';
import { Calendar } from '@/shared/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { cn } from '@/lib/utils';
import { listClosers, type CloserRow } from '@/features/settings-prospecting/actions/closers-crud';

import { getCalendarAuthUrl } from '../actions/manage-calendar';
import { scheduleMeeting, updateMeeting, getLoggedUserEmail } from '../actions/schedule-meeting';

export interface MeetingEditData {
  interactionId: string;
  title: string;
  description?: string;
  date: string;
  startTime: string;
  duration: string;
  attendeeEmails: string;
  closerId?: string;
  generateMeetLink: boolean;
}

interface ScheduleMeetingModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadId: string;
  leadEmail?: string | null;
  leadName?: string | null;
  editData?: MeetingEditData | null;
  /** Render inline (no Dialog wrapper) — used in the lead detail tab */
  inline?: boolean;
}

const DURATION_OPTIONS = [
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hora' },
  { value: '90', label: '1h30' },
];

// Generate time slots from 08:00 to 18:00 in 15-min intervals
function generateTimeSlots(): string[] {
  const slots: string[] = [];
  for (let h = 8; h <= 18; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === 18 && m > 0) break;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

const TIME_SLOTS = generateTimeSlots();

export function ScheduleMeetingModal({
  open,
  onOpenChange,
  leadId,
  leadEmail,
  leadName,
  editData,
  inline = false,
}: ScheduleMeetingModalProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const isEditing = !!editData;
  const [title, setTitle] = useState(`V4 Company + ${leadName ?? 'Lead'}`);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(undefined);
  const [selectedTime, setSelectedTime] = useState('09:00');
  const [duration, setDuration] = useState('60');
  const [customDuration, setCustomDuration] = useState('');
  const [showCustomDuration, setShowCustomDuration] = useState(false);
  const [attendeeEmails, setAttendeeEmails] = useState(leadEmail ?? '');
  const [generateMeetLink, setGenerateMeetLink] = useState(true);

  // Closer selection
  const [closers, setClosers] = useState<CloserRow[]>([]);
  const [closersLoaded, setClosersLoaded] = useState(false);
  const [selectedCloserId, setSelectedCloserId] = useState('');
  const [sdrEmail, setSdrEmail] = useState('');

  function buildAttendees(closerEmail?: string, currentSdrEmail?: string) {
    const emails = [leadEmail, closerEmail, currentSdrEmail ?? sdrEmail]
      .filter((e): e is string => !!e && e.trim() !== '');
    return [...new Set(emails)].join(', ');
  }

  useEffect(() => {
    if (open && !closersLoaded) {
      listClosers().then((result) => {
        if (result.success) setClosers(result.data);
        setClosersLoaded(true);
      });
    }
  }, [open, closersLoaded]);

  useEffect(() => {
    if (open) {
      if (editData) {
        setTitle(editData.title);
        setSelectedDate(editData.date ? new Date(editData.date + 'T12:00:00') : undefined);
        setSelectedTime(editData.startTime);
        setDuration(editData.duration);
        setAttendeeEmails(editData.attendeeEmails);
        setSelectedCloserId(editData.closerId ?? '');
        setGenerateMeetLink(editData.generateMeetLink);
        getLoggedUserEmail().then((r) => { if (r.success) setSdrEmail(r.data); });
      } else {
        setTitle(`V4 Company + ${leadName ?? 'Lead'}`);
        setSelectedDate(undefined);
        setSelectedTime('09:00');
        setDuration('60');
        setShowCustomDuration(false);
        setGenerateMeetLink(true);
        getLoggedUserEmail().then((r) => {
          const email = r.success ? r.data : '';
          setSdrEmail(email);
          setAttendeeEmails(buildAttendees(undefined, email));
          setSelectedCloserId('');
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editData]);

  const effectiveDuration = showCustomDuration && customDuration ? customDuration : duration;

  const dateString = useMemo(() => {
    if (!selectedDate) return '';
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [selectedDate]);

  function handleSubmit() {
    if (!dateString || !selectedTime) {
      toast.error('Selecione a data e hora');
      return;
    }

    const startDateTime = new Date(`${dateString}T${selectedTime}:00`);
    const endDateTime = new Date(startDateTime.getTime() + parseInt(effectiveDuration, 10) * 60 * 1000);

    startTransition(async () => {
      const emails = attendeeEmails.split(',').map((e) => e.trim()).filter(Boolean);
      const eventInput = {
        title,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        attendeeEmails: emails.length > 0 ? emails : undefined,
        generateMeetLink,
        closerId: selectedCloserId || undefined,
      };

      const result = editData
        ? await updateMeeting(editData.interactionId, leadId, eventInput)
        : await scheduleMeeting(leadId, eventInput);

      if (result.success) {
        const meetInfo = result.data?.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
        toast.success(editData ? 'Reunião atualizada!' : `Reunião agendada!${meetInfo}`);
        onOpenChange(false);
        router.refresh();
      } else if (result.code === 'GCAL_TOKEN_EXPIRED') {
        toast.info('Reconectando ao Google Calendar...');
        const authResult = await getCalendarAuthUrl();
        if (authResult.success) window.location.href = authResult.data.url;
        else toast.error('Não foi possível reconectar.');
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#E53935]">
            <CalendarIcon className="h-5 w-5" />
            {isEditing ? 'Editar Reunião' : 'Registrar reunião'}
          </DialogTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Registre aqui a reunião agendada para o closer.
          </p>
        </DialogHeader>

        <div className="space-y-5 mt-2">
          {/* Título */}
          <div>
            <Label className="text-sm font-semibold">Título:</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1" />
          </div>

          {/* Closer (Responsável) */}
          <div>
            <Label className="text-sm font-semibold">Responsável:</Label>
            <select
              className="mt-1 flex h-10 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm"
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
                <option value="">Carregando...</option>
              ) : (
                <>
                  <option value="">Responsável</option>
                  {closers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                  ))}
                </>
              )}
            </select>
          </div>

          {/* Duração — botões */}
          <div>
            <Label className="text-sm font-semibold">Duração:</Label>
            <div className="mt-1 flex gap-2">
              {DURATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => { setDuration(opt.value); setShowCustomDuration(false); }}
                  className={cn(
                    'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                    !showCustomDuration && duration === opt.value
                      ? 'border-[#E53935] text-[#E53935] bg-[#E53935]/5'
                      : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]',
                  )}
                >
                  {opt.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowCustomDuration(true)}
                className={cn(
                  'rounded-md border px-4 py-2 text-sm font-medium transition-colors',
                  showCustomDuration
                    ? 'border-[#E53935] text-[#E53935] bg-[#E53935]/5'
                    : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--foreground)]',
                )}
              >
                Outro
              </button>
            </div>
            {showCustomDuration && (
              <div className="mt-2 flex items-center gap-2">
                <Input
                  type="number"
                  placeholder="Minutos"
                  value={customDuration}
                  onChange={(e) => setCustomDuration(e.target.value)}
                  className="w-24"
                  min={5}
                  max={480}
                />
                <span className="text-sm text-[var(--muted-foreground)]">minutos</span>
              </div>
            )}
          </div>

          {/* Data e Hora — calendário + time slots */}
          <div>
            <Label className="text-sm font-semibold">Data e Hora:</Label>
            <div className="mt-2 flex flex-col gap-4 sm:flex-row">
              {/* Calendário */}
              <div className="rounded-md border border-[var(--border)] p-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                />
              </div>

              {/* Time slots */}
              <div className="flex-1 rounded-md border border-[var(--border)] overflow-y-auto max-h-[320px]">
                <div className="flex flex-col">
                  {TIME_SLOTS.map((slot) => (
                    <button
                      key={slot}
                      type="button"
                      onClick={() => setSelectedTime(slot)}
                      className={cn(
                        'border-b border-[var(--border)] last:border-0 px-4 py-2.5 text-sm text-center transition-colors',
                        selectedTime === slot
                          ? 'bg-[#E53935]/10 text-[#E53935] font-semibold'
                          : 'hover:bg-[var(--muted)]/50',
                      )}
                    >
                      {slot}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Emails dos participantes */}
          <div>
            <Label className="text-sm font-semibold">Emails dos participantes:</Label>
            <Input
              value={attendeeEmails}
              onChange={(e) => setAttendeeEmails(e.target.value)}
              placeholder="lead@exemplo.com, sdr@empresa.com"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-[var(--muted-foreground)]">Separe múltiplos emails com vírgula</p>
          </div>

          {/* Google Meet */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={generateMeetLink}
              onChange={(e) => setGenerateMeetLink(e.target.checked)}
              className="rounded accent-[#E53935]"
            />
            <Video className="h-4 w-4" />
            Gerar link do Google Meet
          </label>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !dateString || !selectedTime}
            className="bg-[#E53935] hover:bg-[#C62828] text-white"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {isPending
              ? (isEditing ? 'Salvando...' : 'Agendando...')
              : (isEditing ? 'Salvar' : 'Agendar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
