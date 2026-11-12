import { classifySlot, type BusyInterval as CloserBusyInterval } from '@/features/meetings/closer-availability.logic';
import { MEETING_DURATION_MIN } from '@/features/meetings/meeting-duration';

/** Grade semanal em America/Sao_Paulo, sem depender do fuso do processo. */

const BRT_OFFSET_MIN = -180;

/** Linhas da grade: 09:00 até 16:00, inclusive. */
export const SLOT_START_HOURS = [9, 10, 11, 12, 13, 14, 15, 16] as const;
/** Mesma duração de `MEETING_DURATION_MIN`. A agenda BDR continua com 45 min. */
export const SLOT_DURATION_MIN = MEETING_DURATION_MIN;

export interface BusyInterval {
  start: string;
  end: string;
  /** Título do evento do Google (já com a regra de "Privado"). */
  title?: string;
}

export type SlotState = 'free' | 'busy' | 'unknown';

/**
 * Origem da ocupação. `app`: reunião já marcada no Enriquece ou trava, sempre
 * bloqueada. `calendar`: só o Google, pode ser marcada com confirmação.
 */
export type SlotBusySource = 'calendar' | 'app' | 'holiday';

export interface WeekSlot {
  id: string;
  start: Date;
  end: Date;
  dayIndex: number;
  hour: number;
  /** Ocupado no calendário do closer, em reunião do app ou em feriado. */
  busy: boolean;
  past: boolean;
  state: SlotState;
  holiday: boolean;
  /** Aviso da agenda do SDR. Não torna o horário do closer indisponível. */
  sdrBusy: boolean;
  busySource?: SlotBusySource;
  /** Primeiro evento do Google que cruza o horário. */
  title?: string;
  /** Quantos outros eventos com título cruzam o horário (o "+N"). */
  extraEventCount?: number;
}

function brtParts(d: Date) {
  const shifted = new Date(d.getTime() + BRT_OFFSET_MIN * 60000);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    h: shifted.getUTCHours(),
    min: shifted.getUTCMinutes(),
    dow: shifted.getUTCDay(),
  };
}

function fromBrt(y: number, m: number, day: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, day, h, min) - BRT_OFFSET_MIN * 60000);
}

/** Segunda-feira 00:00 BRT da semana que contém `anchor`. */
export function startOfWorkWeek(anchor: Date): Date {
  const p = brtParts(anchor);
  const mondayOffset = p.dow === 0 ? -6 : 1 - p.dow;
  return fromBrt(p.y, p.m, p.day + mondayOffset, 0, 0);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

const WEEKDAY = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
const WEEKDAY_LONG = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTH_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export function weekdayLabel(dayIndex: number): string {
  return WEEKDAY[dayIndex] ?? '';
}

/** "9 – 13 de novembro de 2026 · America/Sao_Paulo" para a semana útil. */
export function formatWeekRange(weekStart: Date): string {
  const start = brtParts(weekStart);
  const end = brtParts(addDays(weekStart, 4));
  const zone = 'America/Sao_Paulo';
  if (start.y === end.y && start.m === end.m) {
    return `${start.day} – ${end.day} de ${MONTH_LONG[start.m]} de ${start.y} · ${zone}`;
  }
  if (start.y === end.y) {
    return `${start.day} de ${MONTH_LONG[start.m]} – ${end.day} de ${MONTH_LONG[end.m]} de ${end.y} · ${zone}`;
  }
  return `${start.day} de ${MONTH_LONG[start.m]} de ${start.y} – ${end.day} de ${MONTH_LONG[end.m]} de ${end.y} · ${zone}`;
}

/** "segunda-feira, 9 de novembro · 14:00 - 15:00". */
export function formatBrtMeetingWhen(start: Date, end: Date): string {
  const s = brtParts(start);
  const e = brtParts(end);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAY_LONG[s.dow]}, ${s.day} de ${MONTH_LONG[s.m]} · ${pad(s.h)}:${pad(s.min)} - ${pad(e.h)}:${pad(e.min)}`;
}

export function formatBrtWallClock(date: Date): { date: string; time: string; dayMonth: string } {
  const p = brtParts(date);
  const month = String(p.m + 1).padStart(2, '0');
  const day = String(p.day).padStart(2, '0');
  return {
    date: `${p.y}-${month}-${day}`,
    time: `${String(p.h).padStart(2, '0')}:${String(p.min).padStart(2, '0')}`,
    dayMonth: `${day}/${month}`,
  };
}

function overlaps(slotStart: Date, slotEnd: Date, busy: BusyInterval): boolean {
  const start = new Date(busy.start).getTime();
  const end = new Date(busy.end).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return slotStart.getTime() < end && start < slotEnd.getTime();
}

export function buildWeekSlots(weekStart: Date, busy: BusyInterval[], now: Date): WeekSlot[] {
  const slots: WeekSlot[] = [];
  for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
    const day = brtParts(addDays(weekStart, dayIndex));
    for (const hour of SLOT_START_HOURS) {
      const start = fromBrt(day.y, day.m, day.day, hour, 0);
      const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60_000);
      const isBusy = busy.some((interval) => overlaps(start, end, interval));
      slots.push({
        id: start.toISOString(),
        start,
        end,
        dayIndex,
        hour,
        busy: isBusy,
        past: start.getTime() < now.getTime(),
        state: isBusy ? 'busy' : 'free',
        holiday: false,
        sdrBusy: false,
      });
    }
  }
  return slots;
}

export interface CloserWeekInput {
  calendarKnown: boolean;
  calendarBusy: BusyInterval[];
  appBusy: BusyInterval[];
  holidays: readonly string[];
  sdrBusy: BusyInterval[];
  now: Date;
}

/** Grade de um closer: livre, ocupado ou desconhecido. Desconhecido não é livre. */
export function buildCloserWeekSlots(weekStart: Date, input: CloserWeekInput): WeekSlot[] {
  const holidays = new Set(input.holidays);
  const slots: WeekSlot[] = [];
  for (let dayIndex = 0; dayIndex < 5; dayIndex++) {
    const day = brtParts(addDays(weekStart, dayIndex));
    const dateKey = `${day.y}-${String(day.m + 1).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
    for (const hour of SLOT_START_HOURS) {
      const start = fromBrt(day.y, day.m, day.day, hour, 0);
      const end = new Date(start.getTime() + SLOT_DURATION_MIN * 60_000);
      const kind = classifySlot({
        start,
        end,
        calendarKnown: input.calendarKnown,
        calendarBusy: input.calendarBusy as CloserBusyInterval[],
        appMeetings: input.appBusy as CloserBusyInterval[],
        holiday: holidays.has(dateKey),
      });
      const state: SlotState = kind === 'unknown' ? 'unknown' : kind === 'free' ? 'free' : 'busy';
      const titled = (input.calendarKnown ? input.calendarBusy : [])
        .filter((interval) => !!interval.title && overlaps(start, end, interval))
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
      const first = titled[0];
      const busySource: SlotBusySource | undefined = kind === 'holiday'
        ? 'holiday'
        : kind === 'busy'
          ? 'app'
          : kind === 'calendar_busy'
            ? 'calendar'
            : undefined;
      slots.push({
        id: start.toISOString(),
        start,
        end,
        dayIndex,
        hour,
        busy: state === 'busy',
        past: start.getTime() < input.now.getTime(),
        state,
        holiday: kind === 'holiday',
        sdrBusy: input.sdrBusy.some((interval) => overlaps(start, end, interval)),
        busySource,
        ...(first && kind !== 'holiday' ? { title: first.title, extraEventCount: titled.length - 1 } : {}),
      });
    }
  }
  return slots;
}

/** Ocupado só no Google: pode ser marcado depois que o SDR confirma. */
export function slotNeedsOverlapConfirm(slot: WeekSlot): boolean {
  return slot.state === 'busy' && slot.busySource === 'calendar' && !slot.holiday && !slot.past;
}

/**
 * Livre, ou ocupado só no Google. Passado, feriado, sem dados e reunião do
 * Enriquece nunca são selecionáveis.
 */
export function slotSelectable(slot: WeekSlot): boolean {
  if (slot.past || slot.holiday || slot.state === 'unknown') return false;
  if (slot.state === 'free') return true;
  return slotNeedsOverlapConfirm(slot);
}
