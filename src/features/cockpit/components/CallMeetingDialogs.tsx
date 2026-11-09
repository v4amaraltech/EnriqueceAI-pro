'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';
import { Calendar as CalendarIcon, ChevronDown, ChevronLeft, ChevronRight, Trash2, Video, X } from 'lucide-react';
import { toast } from 'sonner';

import { cn } from '@/lib/utils';
import { Button } from '@/shared/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/components/ui/dialog';
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
  formatBrtMeetingWhen,
  formatBrtWallClock,
  formatWeekRange,
  slotSelectable,
  startOfWorkWeek,
  weekdayLabel,
  SLOT_START_HOURS,
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

const AVATAR_TONES = [
  'bg-rose-100 text-rose-800',
  'bg-sky-100 text-sky-800',
  'bg-amber-100 text-amber-800',
  'bg-emerald-100 text-emerald-800',
  'bg-violet-100 text-violet-800',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  const letters = parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
  return letters || '?';
}

function avatarTone(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash + char.charCodeAt(0)) % AVATAR_TONES.length;
  return AVATAR_TONES[hash] ?? 'bg-muted text-foreground';
}

function mapCloser(row: { id: string; name: string; email: string }): MeetingCloser {
  return { id: row.id, name: row.name, email: row.email };
}

export function CallMeetingWeekDialog({ open, onOpenChange, preview, onChoose }: WeekDialogProps) {
  const clock = useMemo(() => preview?.now ?? new Date(), [preview]);
  const [filter, setFilter] = useState<'all' | 'closers'>('closers');
  const [weekStart, setWeekStart] = useState(() => startOfWorkWeek(preview?.now ?? new Date()));
  const [liveAll, setLiveAll] = useState<MeetingCloser[]>([]);
  const [liveSchedulable, setLiveSchedulable] = useState<MeetingCloser[]>([]);
  const [liveBusy, setLiveBusy] = useState<BusyInterval[]>([]);
  const [availabilityNote, setAvailabilityNote] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedCloserId, setSelectedCloserId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);

  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    void Promise.all([listClosers(), listClosers({ onlySchedulable: true })]).then(([all, schedulable]) => {
      if (cancelled) return;
      setLiveAll(all.success ? all.data.map(mapCloser) : []);
      setLiveSchedulable(schedulable.success ? schedulable.data.map(mapCloser) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, preview]);

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

  const allClosers = preview ? preview.closersAll : liveAll;
  const schedulable = preview ? preview.closersSchedulable : liveSchedulable;
  const closers = filter === 'closers' ? schedulable : allClosers;
  const busy = preview ? preview.busy : liveBusy;
  const slots = useMemo(() => buildWeekSlots(weekStart, busy, clock), [weekStart, busy, clock]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedCloser = closers.find((closer) => closer.id === selectedCloserId)
    ?? allClosers.find((closer) => closer.id === selectedCloserId)
    ?? null;
  const days = [0, 1, 2, 3, 4].map((dayIndex) => {
    const sample = slots.find((slot) => slot.dayIndex === dayIndex);
    return { dayIndex, label: weekdayLabel(dayIndex), date: sample ? formatBrtWallClock(sample.start).dayMonth.slice(0, 2) : '' };
  });

  function applyFilter(next: 'all' | 'closers', openList = false) {
    setFilter(next);
    setListOpen(openList);
    const pool = next === 'closers' ? schedulable : allClosers;
    if (selectedCloserId && !pool.some((closer) => closer.id === selectedCloserId)) setSelectedCloserId(null);
  }

  function clearSelection() {
    setSelectedSlotId(null);
    setSelectedCloserId(null);
  }

  function choose() {
    if (!selectedSlot || !selectedCloser || !slotSelectable(selectedSlot)) return;
    onChoose({ start: selectedSlot.start, end: selectedSlot.end, closer: selectedCloser });
  }

  const whenLabel = selectedSlot
    ? `${weekdayLabel(selectedSlot.dayIndex)} ${formatBrtWallClock(selectedSlot.start).dayMonth} · ${formatBrtWallClock(selectedSlot.start).time}`
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-[90vh] w-[min(80vw,calc(100%-1.5rem))] max-w-[80vw] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-[80vw]"
        data-testid="call-week-dialog"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>Agendar reunião</DialogTitle>
          <DialogDescription>
            Horários ocupados são os do seu Google Calendar. A agenda de cada closer não é consultada; o closer escolhido entra como responsável e participante.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-3">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <button type="button" className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Semana anterior" onClick={() => { setAvailabilityNote(null); setWeekStart((current) => addDays(current, -7)); setSelectedSlotId(null); }}>
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button type="button" className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Próxima semana" onClick={() => { setAvailabilityNote(null); setWeekStart((current) => addDays(current, 7)); setSelectedSlotId(null); }}>
              <ChevronRight className="h-4 w-4" />
            </button>
            <p className="truncate">{formatWeekRange(weekStart)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-pressed={filter === 'all'}
              onClick={() => applyFilter('all')}
              className={cn('bg-background h-8 rounded-md border px-2.5 text-xs', filter === 'all' ? 'border-foreground' : 'border-input text-muted-foreground')}
            >
              Todos
            </button>
            <div className="relative">
              <button
                type="button"
                aria-label={`Closers ${closers.length}`}
                aria-pressed={filter === 'closers'}
                aria-expanded={listOpen}
                onClick={() => {
                  if (filter !== 'closers') {
                    applyFilter('closers', true);
                    return;
                  }
                  setListOpen((current) => !current);
                }}
                className={cn('bg-background flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs', filter === 'closers' ? 'border-foreground' : 'border-input text-muted-foreground')}
              >
                Closers
                <span className="text-muted-foreground tabular-nums">{closers.length}</span>
                <ChevronDown className="text-muted-foreground h-3.5 w-3.5" />
              </button>
              {listOpen && (
                <ul className="border-border bg-background absolute right-0 z-10 mt-1 max-h-60 w-64 overflow-auto rounded-md border p-1 shadow-md" role="listbox" aria-label="Closers">
                  {closers.length === 0 ? (
                    <li className="text-muted-foreground px-2 py-2 text-xs">Nenhum closer neste filtro.</li>
                  ) : closers.map((closer) => (
                    <li key={closer.id}>
                      <button
                        type="button"
                        role="option"
                        data-testid={`closer-${closer.id}`}
                        aria-selected={closer.id === selectedCloserId}
                        onClick={() => { setSelectedCloserId(closer.id); setListOpen(false); }}
                        className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                      >
                        <Avatar id={closer.id} name={closer.name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{closer.name}</span>
                          <span className="text-muted-foreground block truncate">{closer.email}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <DialogClose
              className="text-muted-foreground hover:text-foreground ml-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
              aria-label="Fechar"
            >
              <X className="h-4 w-4" />
            </DialogClose>
          </div>
        </div>
        {availabilityNote && <p className="px-6 pb-2 text-xs text-amber-700">{availabilityNote}</p>}
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-4">
          <div className="grid h-full grid-cols-[3.25rem_repeat(5,minmax(0,1fr))] grid-rows-[auto_repeat(8,minmax(4.25rem,1fr))] gap-2">
            <div />
            {days.map((day) => (
              <div key={day.dayIndex} className="text-muted-foreground pb-1 text-center text-xs">
                <div>{day.label}</div>
                <div className="tabular-nums">{day.date}</div>
              </div>
            ))}
            {SLOT_START_HOURS.map((hour) => (
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
        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            {selectedCloser ? (
              <>
                <Avatar id={selectedCloser.id} name={selectedCloser.name} />
                <div className="min-w-0">
                  <p className="truncate font-medium">{selectedCloser.name}</p>
                  <p className="text-muted-foreground truncate text-xs">{whenLabel ?? 'Escolha um horário'}</p>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-xs">{whenLabel ?? 'Escolha um horário e um closer'}</p>
            )}
            {(selectedCloser || selectedSlot) && (
              <button type="button" className="text-muted-foreground hover:text-foreground rounded-md p-1" aria-label="Limpar seleção" onClick={clearSelection}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="button" className="transition-none" onClick={choose} disabled={!selectedSlot || !selectedCloser || !slotSelectable(selectedSlot)}>
            Agendar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold', avatarTone(id))} aria-hidden>
      {initials(name)}
    </span>
  );
}

function HourRow({ hour, slots, selectedId, onSelect }: { hour: number; slots: WeekSlot[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <>
      <div className="text-muted-foreground pt-2 text-right text-[11px] tabular-nums">{String(hour).padStart(2, '0')}:00</div>
      {slots.map((slot) => {
        const selectable = slotSelectable(slot);
        const selected = slot.id === selectedId;
        const time = formatBrtWallClock(slot.start).time;
        return (
          <button
            key={slot.id}
            type="button"
            disabled={!selectable}
            aria-pressed={selected}
            data-testid={`slot-${slot.dayIndex}-${slot.hour}`}
            onClick={() => onSelect(slot.id)}
            className={cn(
              'flex h-full min-h-16 flex-col items-start gap-1 rounded-md border px-2 py-1.5 text-left',
              slot.busy && 'bg-muted text-muted-foreground border-transparent',
              slot.past && !slot.busy && 'bg-muted/50 border-transparent opacity-60',
              selectable && !selected && 'bg-background border-border hover:border-foreground/30',
              selected && 'bg-foreground text-background border-foreground',
            )}
          >
            <span className={cn('text-[11px] tabular-nums', selected ? 'text-background/70' : 'text-muted-foreground')}>{time}</span>
            {slot.busy && <span className="text-xs">Ocupado</span>}
            {slot.past && !slot.busy && <span className="sr-only">Passou</span>}
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
  const [closer, setCloser] = useState<MeetingCloser | null>(choice?.closer ?? null);
  const [closerOptions, setCloserOptions] = useState<MeetingCloser[]>(preview?.closersAll ?? []);

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
    void listClosers().then((result) => {
      if (!cancelled && result.success) setCloserOptions(result.data.map(mapCloser));
    });
    return () => {
      cancelled = true;
    };
  }, [open, choice, leadId, preview]);

  useEffect(() => {
    if (!open) inFlight.current = false;
  }, [open]);

  if (!choice || !closer) return null;
  const wall = formatBrtWallClock(choice.start);
  const options = closerOptions.some((item) => item.id === closer.id) ? closerOptions : [closer, ...closerOptions];
  const participants = [
    { role: 'Closer', roleLabel: 'responsável', name: closer.name, email: closer.email },
    { role: 'Organizador', roleLabel: 'organizador', name: organizerEmail || 'Você', email: organizerEmail },
    { role: 'Lead', roleLabel: 'lead', name: leadName, email: leadEmail ?? '' },
  ];

  function submit() {
    if (!choice || !closer || inFlight.current) return;
    const amount = parseMoney(faturamento);
    if (amount === null) {
      toast.error('Informe o faturamento estimado do lead (em R$) antes de agendar.');
      return;
    }
    if (missing.length > 0) {
      toast.error(`Preencha os campos obrigatórios antes de agendar: ${missing.map((field) => field.label).join(', ')}`);
      return;
    }
    const emails = [leadEmail, closer.email, organizerEmail].map((email) => email?.trim() ?? '').filter(Boolean);
    const eventInput = {
      title: title.trim() || `V4 Company + ${leadName}`,
      description: description.trim() || undefined,
      startTime: `${wall.date}T${wall.time}:00`,
      endTime: wallIso(choice.end),
      attendeeEmails: [...new Set(emails)],
      generateMeetLink,
      closerId: closer.id,
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
        <DialogContent className="flex max-h-[90vh] w-full max-w-[480px] flex-col gap-0 overflow-hidden bg-background p-0 sm:max-w-[480px]" data-testid="meeting-confirm-dialog">
          <div className="px-6 pt-6 pb-2">
            <DialogHeader className="gap-0 text-left">
              <DialogTitle className="text-base font-semibold">Detalhes da Reunião</DialogTitle>
              <DialogDescription className="sr-only">
                Revise responsável, convite e participantes. Confirmar grava a reunião, qualifica o lead e encerra a prospecção ativa. O histórico anterior permanece.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="min-h-0 flex-auto space-y-4 overflow-y-auto px-6 py-2">
            <div className="bg-muted flex items-center gap-3 rounded-lg px-4 py-3 text-sm">
              <CalendarIcon className="text-muted-foreground h-4 w-4 shrink-0" />
              <span>{formatBrtMeetingWhen(choice.start, choice.end)}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-owner" className="text-muted-foreground text-xs font-normal">Responsável por conduzir a reunião *</Label>
              <div className="border-input flex items-center gap-2 rounded-md border px-2">
                <Avatar id={closer.id} name={closer.name} />
                <select
                  id="meeting-owner"
                  value={closer.id}
                  onChange={(event) => {
                    const next = options.find((item) => item.id === event.target.value);
                    if (next) setCloser(next);
                  }}
                  className="bg-background h-10 min-w-0 flex-1 text-sm outline-none"
                >
                  {options.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-title" className="text-muted-foreground text-xs font-normal">Título do convite da reunião</Label>
              <Input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <p className="text-muted-foreground text-xs">Será o título da reunião do convite no Google Meet</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-description" className="text-muted-foreground text-xs font-normal">Descrição do convite</Label>
              <Textarea id="meeting-description" value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-24" />
              <p className="text-muted-foreground text-xs">Entra no corpo do convite enviado aos participantes.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-revenue" className="text-muted-foreground text-xs font-normal">Faturamento estimado (R$) *</Label>
              <Input id="meeting-revenue" value={faturamento} onChange={(event) => setFaturamento(event.target.value)} inputMode="decimal" />
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-amber-700">Preencha antes de agendar: {missing.map((field) => field.label).join(', ')}</p>
            )}
            <section className="space-y-1">
              <h3 className="text-sm font-medium">Participantes</h3>
              <ul>
                {participants.map((person) => (
                  <li key={person.role} data-testid={`participant-${person.role}`} className="flex items-center gap-3 py-2">
                    <Avatar id={person.email || person.role} name={person.name} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{person.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {person.email ? `${person.email} · ${person.roleLabel}` : person.roleLabel}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input type="checkbox" checked={generateMeetLink} onChange={(event) => setGenerateMeetLink(event.target.checked)} />
              <Video className="h-3.5 w-3.5" />
              Incluir Google Meet no convite
            </label>
          </div>
          <div className="px-6 pt-2 pb-6">
            <Button type="button" className="w-full" onClick={submit} disabled={isPending || missing.length > 0} data-testid="confirm-meeting">
              {isPending ? 'Agendando...' : 'Confirmar agendamento'}
            </Button>
          </div>
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
