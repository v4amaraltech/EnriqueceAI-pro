'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
import { Input } from '@/shared/components/ui/input';
import { Label } from '@/shared/components/ui/label';
import { Textarea } from '@/shared/components/ui/textarea';

import { checkWhatsAppConnected } from '@/features/activities/actions/check-whatsapp-status';
import { getCalendarAuthUrl } from '@/features/integrations/actions/manage-calendar';
import { getAvailability, getLeadFaturamento, getLoggedUserEmail, scheduleMeeting } from '@/features/integrations/actions/schedule-meeting';
import { WhatsAppInviteModal } from '@/features/integrations/components/WhatsAppInviteModal';
import { getMissingMeetingFields } from '@/features/leads/actions/get-missing-meeting-fields';
import type { MissingRequiredField } from '@/features/leads/utils/required-field-validation';
import { listClosers } from '@/features/settings-prospecting/actions/closers-crud';

import {
  addDays,
  buildWeekSlots,
  formatBrtWallClock,
  slotSelectable,
  startOfWorkWeek,
  weekdayLabel,
  type BusyInterval,
  type WeekSlot,
} from '../utils/week-slots';

export interface MeetingCloser {
  id: string;
  name: string;
  email: string;
}

export interface MeetingChoice {
  start: Date;
  end: Date;
  closer: MeetingCloser;
}

export interface SchedulingPreview {
  closersAll: MeetingCloser[];
  closersSchedulable: MeetingCloser[];
  busy: BusyInterval[];
  now: Date;
  organizerEmail: string;
  /** Fixture: não cria evento, convite nem reunião. */
  skipSubmit?: boolean;
}

interface WeekDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview?: SchedulingPreview;
  onChoose: (choice: MeetingChoice) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || '?';
}

export function CallMeetingWeekDialog({ open, onOpenChange, preview, onChoose }: WeekDialogProps) {
  const clock = useMemo(() => preview?.now ?? new Date(), [preview]);
  const [filter, setFilter] = useState<'all' | 'closers'>('closers');
  const [weekStart, setWeekStart] = useState(() => startOfWorkWeek(preview?.now ?? new Date()));
  const [liveClosers, setLiveClosers] = useState<MeetingCloser[]>([]);
  const [liveBusy, setLiveBusy] = useState<BusyInterval[]>([]);
  const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedCloserId, setSelectedCloserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    void listClosers({ onlySchedulable: filter === 'closers' }).then((result) => {
      if (cancelled) return;
      setLiveClosers(result.success ? result.data.map((row) => ({ id: row.id, name: row.name, email: row.email })) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, filter, preview]);

  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    void getAvailability(weekStart.toISOString(), addDays(weekStart, 5).toISOString()).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setLiveBusy(result.data);
        setAvailabilityNote(null);
      } else {
        setLiveBusy([]);
        setAvailabilityNote(result.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, preview, weekStart]);

  const closers = preview ? (filter === 'closers' ? preview.closersSchedulable : preview.closersAll) : liveClosers;
  const busy = preview ? preview.busy : liveBusy;
  const slots = useMemo(() => buildWeekSlots(weekStart, busy, clock), [weekStart, busy, clock]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedCloser = closers.find((closer) => closer.id === selectedCloserId) ?? null;
  const days = [0, 1, 2, 3, 4].map((dayIndex) => {
    const sample = slots.find((slot) => slot.dayIndex === dayIndex);
    return { dayIndex, label: weekdayLabel(dayIndex), date: sample ? formatBrtWallClock(sample.start).dayMonth : '' };
  });

  function choose() {
    if (!selectedSlot || !selectedCloser || !slotSelectable(selectedSlot)) return;
    onChoose({ start: selectedSlot.start, end: selectedSlot.end, closer: selectedCloser });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl" data-testid="call-week-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5 text-primary" />
            Agendar reunião
          </DialogTitle>
          <DialogDescription>Escolha um horário livre e o closer responsável.</DialogDescription>
        </DialogHeader>
        <p className="text-muted-foreground text-xs">
          Horários ocupados são os do seu Google Calendar. A agenda individual de cada closer não é lida nesta tela — o closer escolhido entra como responsável e participante.
        </p>
        {availabilityNote && <p className="text-xs text-amber-700">{availabilityNote}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Semana anterior" onClick={() => { setAvailabilityNote(null); setWeekStart((current) => addDays(current, -7)); }}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button type="button" size="icon" variant="outline" className="h-8 w-8" aria-label="Próxima semana" onClick={() => { setAvailabilityNote(null); setWeekStart((current) => addDays(current, 7)); }}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex gap-1" role="group" aria-label="Filtro de closers">
            <FilterButton active={filter === 'all'} onClick={() => setFilter('all')}>Todos</FilterButton>
            <FilterButton active={filter === 'closers'} onClick={() => setFilter('closers')}>Closers</FilterButton>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="grid min-w-[36rem] grid-cols-[3rem_repeat(5,minmax(0,1fr))] gap-1 text-xs">
            <div />
            {days.map((day) => (
              <div key={day.dayIndex} className="px-1 text-center font-medium">
                {day.label}
                <div className="text-muted-foreground font-normal">{day.date}</div>
              </div>
            ))}
            {[8, 9, 10, 11, 12, 13, 14, 15, 16, 17].map((hour) => (
              <HourRow
                key={hour}
                hour={hour}
                slots={slots.filter((slot) => slot.hour === hour)}
                selectedId={selectedSlotId}
                onSelect={setSelectedSlotId}
              />
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Closer</p>
          {closers.length === 0 ? (
            <p className="text-muted-foreground text-xs">Nenhum closer neste filtro.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {closers.map((closer) => {
                const selected = closer.id === selectedCloserId;
                return (
                  <li key={closer.id}>
                    <button
                      type="button"
                      data-testid={`closer-${closer.id}`}
                      aria-pressed={selected}
                      onClick={() => setSelectedCloserId(closer.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-2 py-1 text-left text-xs',
                        selected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
                      )}
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-[11px] font-semibold" aria-hidden>
                        {initials(closer.name)}
                      </span>
                      <span>
                        <span className="block font-medium">{closer.name}</span>
                        <span className="text-muted-foreground block">{closer.email}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button type="button" onClick={choose} disabled={!selectedSlot || !selectedCloser || !slotSelectable(selectedSlot)}>
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn('rounded-md px-3 py-1 text-xs font-medium', active ? 'bg-primary text-primary-foreground' : 'border')}
    >
      {children}
    </button>
  );
}

function HourRow({ hour, slots, selectedId, onSelect }: { hour: number; slots: WeekSlot[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <div className="text-muted-foreground self-center text-right tabular-nums">{String(hour).padStart(2, '0')}h</div>
      {slots.map((slot) => {
        const selectable = slotSelectable(slot);
        const selected = slot.id === selectedId;
        return (
          <button
            key={slot.id}
            type="button"
            disabled={!selectable}
            aria-pressed={selected}
            data-testid={`slot-${slot.dayIndex}-${slot.hour}`}
            onClick={() => onSelect(slot.id)}
            className={cn(
              'h-8 rounded border text-[11px]',
              slot.busy && 'bg-muted text-muted-foreground',
              slot.past && !slot.busy && 'text-muted-foreground/60',
              selectable && 'hover:border-primary',
              selected && 'border-primary bg-primary/10 font-medium',
            )}
          >
            {slot.busy ? 'Ocupado' : slot.past ? 'Passou' : 'Livre'}
          </button>
        );
      })}
    </>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  choice: MeetingChoice | null;
  leadId: string;
  leadName: string;
  leadEmail?: string | null;
  onOpenChange: (open: boolean) => void;
  onScheduled: () => void;
  preview?: SchedulingPreview;
}

export function CallMeetingConfirmDialog({ open, choice, leadId, leadName, leadEmail, onOpenChange, onScheduled, preview }: ConfirmDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [title, setTitle] = useState(`V4 Company + ${leadName}`);
  const [description, setDescription] = useState('');
  const [faturamento, setFaturamento] = useState(preview ? 'R$ 1.500.000,00' : '');
  const [generateMeetLink, setGenerateMeetLink] = useState(true);
  const [organizerEmail, setOrganizerEmail] = useState(preview?.organizerEmail ?? '');
  const [missing, setMissing] = useState<MissingRequiredField[]>([]);
  const [invite, setInvite] = useState<{ title: string; date: string; time: string; duration: string; meetLink?: string | null } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [hasWhatsApp, setHasWhatsApp] = useState(false);

  useEffect(() => {
    if (!open || !choice || preview) return;
    let cancelled = false;
    void getLoggedUserEmail().then((result) => {
      if (!cancelled && result.success) setOrganizerEmail(result.data);
    });
    void getLeadFaturamento(leadId).then((result) => {
      if (!cancelled && result.success && result.data !== null) setFaturamento(formatMoney(result.data));
    });
    void getMissingMeetingFields(leadId).then((result) => {
      if (!cancelled && result.success) setMissing(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [open, choice, leadId, preview]);

  useEffect(() => {
    if (!open) inFlight.current = false;
  }, [open]);

  if (!choice) return null;
  const wall = formatBrtWallClock(choice.start);
  const participants = [
    { role: 'Closer', value: `${choice.closer.name} (${choice.closer.email})` },
    { role: 'Organizador', value: organizerEmail || 'você' },
    { role: 'Lead', value: leadEmail ? `${leadName} (${leadEmail})` : leadName },
  ];

  function submit() {
    if (!choice || inFlight.current) return;
    const amount = parseMoney(faturamento);
    if (amount === null) {
      toast.error('Informe o faturamento estimado do lead (em R$) antes de agendar.');
      return;
    }
    if (missing.length > 0) {
      toast.error(`Preencha os campos obrigatórios antes de agendar: ${missing.map((field) => field.label).join(', ')}`);
      return;
    }
    const emails = [leadEmail, choice.closer.email, organizerEmail].map((email) => email?.trim() ?? '').filter(Boolean);
    const eventInput = {
      title: title.trim() || `V4 Company + ${leadName}`,
      description: description.trim() || undefined,
      startTime: `${wall.date}T${wall.time}:00`,
      endTime: wallIso(choice.end),
      attendeeEmails: [...new Set(emails)],
      generateMeetLink,
      closerId: choice.closer.id,
    };
    inFlight.current = true;
    if (preview?.skipSubmit) {
      onScheduled();
      onOpenChange(false);
      return;
    }
    startTransition(async () => {
      try {
        const result = await scheduleMeeting(leadId, eventInput, amount);
        if (!result.success) {
          if (result.code === 'GCAL_TOKEN_EXPIRED') {
            const authResult = await getCalendarAuthUrl();
            if (authResult.success) {
              window.location.href = authResult.data.url;
              return;
            }
          }
          toast.error(result.error);
          return;
        }
        toast.success(result.data.meetLink ? 'Reunião agendada com Meet' : 'Reunião agendada');
        onOpenChange(false);
        onScheduled();
        router.refresh();
        const connected = await checkWhatsAppConnected();
        setHasWhatsApp(connected);
        setInvite({ title: eventInput.title, date: wall.date, time: wall.time, duration: '60', meetLink: result.data.meetLink });
        setInviteOpen(true);
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="meeting-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Confirmar agendamento</DialogTitle>
            <DialogDescription>Revise dia, responsável, participantes e o convite com Meet.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p><span className="font-medium">Quando:</span> {wall.dayMonth} às {wall.time} (60 min)</p>
            <p><span className="font-medium">Responsável:</span> {choice.closer.name}</p>
            <div>
              <Label htmlFor="meeting-title">Título</Label>
              <Input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1" />
            </div>
            <div>
              <Label htmlFor="meeting-description">Descrição</Label>
              <Textarea id="meeting-description" value={description} onChange={(event) => setDescription(event.target.value)} className="mt-1" />
            </div>
            <div>
              <p className="font-medium">Participantes</p>
              <ul className="mt-1 space-y-1">
                {participants.map((person) => (
                  <li key={person.role} data-testid={`participant-${person.role}`}>
                    <span className="text-muted-foreground">{person.role}:</span> {person.value}
                  </li>
                ))}
              </ul>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={generateMeetLink} onChange={(event) => setGenerateMeetLink(event.target.checked)} />
              <Video className="h-4 w-4" />
              Enviar convite com Google Meet
            </label>
            <div>
              <Label htmlFor="meeting-revenue">Faturamento estimado (R$)</Label>
              <Input id="meeting-revenue" value={faturamento} onChange={(event) => setFaturamento(event.target.value)} className="mt-1" inputMode="decimal" />
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-amber-700">Preencha antes de agendar: {missing.map((field) => field.label).join(', ')}</p>
            )}
            <p className="text-muted-foreground text-xs">
              Confirmar grava a reunião, qualifica o lead e encerra a prospecção ativa. O histórico anterior permanece.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Voltar</Button>
            <Button type="button" onClick={submit} disabled={isPending || missing.length > 0} data-testid="confirm-meeting">
              {isPending ? 'Agendando...' : 'Confirmar agendamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {invite && (
        <WhatsAppInviteModal
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          leadId={leadId}
          leadName={leadName}
          hasWhatsApp={hasWhatsApp}
          meeting={invite}
        />
      )}
    </>
  );
}

function wallIso(date: Date): string {
  const wall = formatBrtWallClock(date);
  return `${wall.date}T${wall.time}:00`;
}

function parseMoney(input: string): number | null {
  const cleaned = input.replace(/[^\d,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const value = Number.parseFloat(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}
