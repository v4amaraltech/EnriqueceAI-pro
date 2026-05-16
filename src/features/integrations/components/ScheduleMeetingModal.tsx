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
import { scheduleMeeting, updateMeeting, getLoggedUserEmail, getLeadFaturamento } from '../actions/schedule-meeting';
import { WhatsAppInviteModal } from './WhatsAppInviteModal';
import { checkWhatsAppConnected } from '@/features/activities/actions/check-whatsapp-status';

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
  /** First name of the contact person — used for WhatsApp invite greeting */
  leadFirstName?: string | null;
  editData?: MeetingEditData | null;
  /** Render inline (no Dialog wrapper) — used in the lead detail tab */
  inline?: boolean;
  /** Optional pre-filled title (e.g., "V4 Company + {leadName}") */
  defaultTitle?: string;
  /** Optional pre-filled notes for the meeting description */
  defaultDescription?: string;
  /** Called after a meeting is successfully scheduled (not on edit) */
  onScheduled?: () => void;
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

/** Parse "R$ 1.500.000,50" / "1500000" / "R$ 1.500" → 1500000.5 / 1500000 / 1500. Returns null se inválido. */
function parseFaturamentoInput(input: string): number | null {
  const cleaned = input.replace(/[^\d,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatFaturamentoForInput(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function ScheduleMeetingModal({
  open,
  onOpenChange,
  leadId,
  leadEmail,
  leadName,
  leadFirstName,
  editData,
  inline = false,
  defaultTitle,
  defaultDescription,
  onScheduled,
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

  // Faturamento estimado (obrigatório ao agendar, ignorado ao editar)
  const [faturamentoStr, setFaturamentoStr] = useState('');

  // WhatsApp invite modal
  const [whatsAppInviteOpen, setWhatsAppInviteOpen] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);
  const [meetingForInvite, setMeetingForInvite] = useState<{
    title: string; date: string; time: string; duration: string; meetLink?: string | null;
  } | null>(null);

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

  // Pré-popular faturamento ao abrir (só no modo agendar — não é editado em update)
  useEffect(() => {
    if (open && !editData) {
      setFaturamentoStr('');
      getLeadFaturamento(leadId).then((r) => {
        if (r.success && r.data !== null) {
          setFaturamentoStr(formatFaturamentoForInput(r.data));
        }
      });
    }
  }, [open, editData, leadId]);

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
        setTitle(defaultTitle ?? `V4 Company + ${leadName ?? 'Lead'}`);
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

  const parsedFaturamento = parseFaturamentoInput(faturamentoStr);

  function handleSubmit() {
    if (!dateString || !selectedTime) {
      toast.error('Selecione a data e hora');
      return;
    }

    if (!editData && parsedFaturamento === null) {
      toast.error('Informe o faturamento estimado do lead (em R$) antes de agendar.');
      return;
    }

    // Send local datetime string (no UTC conversion) — Google Calendar uses timeZone param
    const startIso = `${dateString}T${selectedTime}:00`;
    const endMs = new Date(startIso).getTime() + parseInt(effectiveDuration, 10) * 60 * 1000;
    const endDate = new Date(endMs);
    const endIso = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}T${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}:00`;

    startTransition(async () => {
      const emails = attendeeEmails.split(',').map((e) => e.trim()).filter(Boolean);
      const eventInput = {
        title,
        startTime: startIso,
        endTime: endIso,
        attendeeEmails: emails.length > 0 ? emails : undefined,
        generateMeetLink,
        closerId: selectedCloserId || undefined,
      };

      const result = editData
        ? await updateMeeting(editData.interactionId, leadId, eventInput)
        : await scheduleMeeting(leadId, eventInput, parsedFaturamento!);

      if (result.success) {
        const meetInfo = result.data?.meetLink ? ` | Meet: ${result.data.meetLink}` : '';
        toast.success(editData ? 'Reunião atualizada!' : `Reunião agendada!${meetInfo}`);
        onOpenChange(false);
        router.refresh();

        // After scheduling (not editing), prompt WhatsApp invite
        if (!editData) {
          onScheduled?.();
          const whatsAppStatus = await checkWhatsAppConnected();
          setHasWhatsApp(whatsAppStatus);
          setMeetingForInvite({
            title,
            date: dateString,
            time: selectedTime,
            duration: effectiveDuration,
            meetLink: result.data?.meetLink,
          });
          setWhatsAppInviteOpen(true);
        }
      } else if (result.code === 'GCAL_TOKEN_EXPIRED') {
        toast.info('Reconectando ao Google Calendar...');
        const authResult = await getCalendarAuthUrl();
        if (authResult.success) {
          window.location.href = authResult.data.url;
        } else {
          toast.error('Conexão com o Google expirou. Reconecte em Configurações > Integrações.', { duration: 8000 });
          setTimeout(() => { window.location.href = '/settings/integrations'; }, 1500);
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  const header = (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-primary text-lg font-semibold">
        <CalendarIcon className="h-5 w-5" />
        {isEditing ? 'Editar Reunião' : 'Registrar reunião'}
      </div>
      <p className="text-sm text-[var(--muted-foreground)]">
        Registre aqui a reunião agendada para o closer.
      </p>
    </div>
  );

  const formFields = (
        <div className="space-y-5 mt-4">
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

          {/* Faturamento estimado — obrigatório no agendamento */}
          {!isEditing && (
            <div>
              <Label className="text-sm font-semibold">
                Faturamento estimado do lead (R$): <span className="text-destructive">*</span>
              </Label>
              <Input
                value={faturamentoStr}
                onChange={(e) => setFaturamentoStr(e.target.value)}
                onBlur={() => {
                  const n = parseFaturamentoInput(faturamentoStr);
                  if (n !== null) setFaturamentoStr(formatFaturamentoForInput(n));
                }}
                placeholder="R$ 0,00"
                inputMode="decimal"
                className="mt-1"
              />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                Esse valor vai no briefing enviado ao closer. Obrigatório antes de agendar.
              </p>
            </div>
          )}

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
                      ? 'border-primary text-primary bg-primary/5'
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
                    ? 'border-primary text-primary bg-primary/5'
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
                          ? 'bg-primary/10 text-primary font-semibold'
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
              className="rounded accent-primary"
            />
            <Video className="h-4 w-4" />
            Gerar link do Google Meet
          </label>
        </div>
  );

  const footer = (
    <div className={cn('flex gap-2', inline ? 'mt-4' : 'mt-4 justify-end')}>
      {!inline && (
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
      )}
      <Button
        onClick={handleSubmit}
        disabled={isPending || !dateString || !selectedTime || (!editData && parsedFaturamento === null)}
        className="bg-primary hover:bg-primary-700 text-white"
      >
        <CalendarIcon className="mr-2 h-4 w-4" />
        {isPending
          ? (isEditing ? 'Salvando...' : 'Agendando...')
          : (isEditing ? 'Salvar' : 'Agendar')}
      </Button>
    </div>
  );

  const whatsAppInviteElement = meetingForInvite ? (
    <WhatsAppInviteModal
      open={whatsAppInviteOpen}
      onOpenChange={setWhatsAppInviteOpen}
      leadId={leadId}
      leadName={leadName ?? 'Lead'}
      recipientFirstName={leadFirstName}
      hasWhatsApp={hasWhatsApp}
      meeting={meetingForInvite}
    />
  ) : null;

  if (inline) {
    return (
      <div>
        {header}
        {formFields}
        {footer}
        {whatsAppInviteElement}
      </div>
    );
  }

  return (
    <>
    {whatsAppInviteElement}
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-primary">
            <CalendarIcon className="h-5 w-5" />
            {isEditing ? 'Editar Reunião' : 'Registrar reunião'}
          </DialogTitle>
          <p className="text-sm text-[var(--muted-foreground)]">
            Registre aqui a reunião agendada para o closer.
          </p>
        </DialogHeader>
        {formFields}
        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !dateString || !selectedTime || (!editData && parsedFaturamento === null)}
            className="bg-primary hover:bg-primary-700 text-white"
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {isPending
              ? (isEditing ? 'Salvando...' : 'Agendando...')
              : (isEditing ? 'Salvar' : 'Agendar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
