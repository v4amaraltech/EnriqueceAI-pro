/** Grade semanal em America/Sao_Paulo, sem depender do fuso do processo. */

const BRT_OFFSET_MIN = -180;

export const SLOT_START_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17] as const;
export const SLOT_DURATION_MIN = 60;

export interface BusyInterval {
  start: string;
  end: string;
}

export interface WeekSlot {
  id: string;
  start: Date;
  end: Date;
  dayIndex: number;
  hour: number;
  busy: boolean;
  past: boolean;
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

export function weekdayLabel(dayIndex: number): string {
  return WEEKDAY[dayIndex] ?? '';
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
      slots.push({
        id: start.toISOString(),
        start,
        end,
        dayIndex,
        hour,
        busy: busy.some((interval) => overlaps(start, end, interval)),
        past: start.getTime() < now.getTime(),
      });
    }
  }
  return slots;
}

export function slotSelectable(slot: WeekSlot): boolean {
  return !slot.busy && !slot.past;
}
