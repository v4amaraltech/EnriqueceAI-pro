import { MEETING_DURATION_MIN } from './meeting-duration';

/**
 * Agenda do closer no cockpit.
 *
 * A ocupação do SDR é só um aviso. A grade e o bloqueio no servidor olham o
 * closer escolhido. O SDR continua organizador do evento no Google e pode ter
 * outro compromisso no mesmo horário; a célula livre do closer mostra
 * "Você ocupado" sem impedir a marcação.
 *
 * Horário desconhecido (freeBusy falhou, calendário notFound, ou sem conexão)
 * não é livre: a grade não deixa selecionar e o servidor recusa o evento.
 */

export type AvailabilitySource = 'closer_token' | 'sdr_token' | 'none';
export type SlotKind = 'free' | 'busy' | 'unknown' | 'holiday';

export interface BusyInterval {
  start: string;
  end: string;
  leadId?: string;
}

export interface FreeBusyEntry {
  busy?: Array<{ start: string; end: string }>;
  errors?: Array<{ reason?: string; domain?: string }>;
}

export type CalendarRead =
  | { known: true; busy: BusyInterval[] }
  | { known: false; reason: string };

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000;
const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function chooseCalendarSource(input: {
  closerUserId: string | null;
  closerHasConnection: boolean;
  sdrHasConnection: boolean;
}): AvailabilitySource {
  if (input.closerUserId && input.closerHasConnection) return 'closer_token';
  if (input.sdrHasConnection) return 'sdr_token';
  return 'none';
}

export function lookupFreeBusyEntry(
  calendars: Record<string, FreeBusyEntry> | undefined,
  calendarId: string,
): FreeBusyEntry | undefined {
  if (!calendars) return undefined;
  const direct = calendars[calendarId];
  if (direct) return direct;
  const lower = calendarId.toLowerCase();
  const key = Object.keys(calendars).find((item) => item.toLowerCase() === lower);
  return key ? calendars[key] : undefined;
}

/** errors/notFound, ou calendário ausente na resposta, nunca viram lista livre. */
export function interpretFreeBusyEntry(entry: FreeBusyEntry | undefined): CalendarRead {
  if (!entry) return { known: false, reason: 'sem_resposta' };
  const reasons = (entry.errors ?? []).map((error) => error.reason?.trim()).filter((reason): reason is string => !!reason);
  if ((entry.errors?.length ?? 0) > 0) {
    return { known: false, reason: reasons.join(',') || 'erro' };
  }
  return { known: true, busy: (entry.busy ?? []).map((slot) => ({ start: slot.start, end: slot.end })) };
}

export function meetingInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(trimmed)) {
    const parsed = new Date(trimmed);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }
  const match = WALL_CLOCK.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) + BRT_OFFSET_MS);
}

export function meetingWindow(startValue: string, endValue?: string | null, durationMin = MEETING_DURATION_MIN): BusyInterval | null {
  const start = meetingInstant(startValue);
  if (!start) return null;
  const explicitEnd = endValue ? meetingInstant(endValue) : null;
  const end = explicitEnd && explicitEnd.getTime() > start.getTime()
    ? explicitEnd
    : new Date(start.getTime() + durationMin * 60_000);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function intervalsOverlap(start: Date, end: Date, other: BusyInterval): boolean {
  const otherStart = meetingInstant(other.start);
  const otherEnd = meetingInstant(other.end);
  if (!otherStart || !otherEnd) return false;
  return start.getTime() < otherEnd.getTime() && otherStart.getTime() < end.getTime();
}

export function classifySlot(input: {
  start: Date;
  end: Date;
  calendarKnown: boolean;
  calendarBusy: BusyInterval[];
  appMeetings: BusyInterval[];
  holiday: boolean;
}): SlotKind {
  if (input.holiday) return 'holiday';
  if (input.appMeetings.some((meeting) => intervalsOverlap(input.start, input.end, meeting))) return 'busy';
  if (!input.calendarKnown) return 'unknown';
  if (input.calendarBusy.some((meeting) => intervalsOverlap(input.start, input.end, meeting))) return 'busy';
  return 'free';
}

export function bookingDecision(kind: SlotKind): { allow: boolean; code: string; error: string } {
  if (kind === 'free') return { allow: true, code: '', error: '' };
  if (kind === 'holiday') {
    return { allow: false, code: 'CLOSER_HOLIDAY', error: 'Este dia é feriado. Escolha outro horário.' };
  }
  if (kind === 'busy') {
    return { allow: false, code: 'CLOSER_BUSY', error: 'Este closer já está ocupado neste horário.' };
  }
  return {
    allow: false,
    code: 'CLOSER_UNKNOWN',
    error: 'Não foi possível confirmar a agenda deste closer. O horário não foi marcado como livre.',
  };
}

export function availabilityNotice(input: {
  closerSelected: boolean;
  source: AvailabilitySource;
  calendarKnown: boolean;
  reason?: string | null;
  appUnreadable?: boolean;
}): string | null {
  if (!input.closerSelected) {
    return 'Escolha um closer para ver a agenda dele. Sem closer, nenhum horário fica livre.';
  }
  if (input.appUnreadable) {
    return 'Não foi possível ler as reuniões já marcadas deste closer. Nenhum horário foi marcado como livre.';
  }
  if (!input.calendarKnown) {
    if (input.source === 'none') {
      return 'Este closer não tem calendário conectado e o seu Google não consegue consultar a agenda. Os horários não estão livres.';
    }
    if (input.reason?.includes('notFound')) {
      return 'O Google não encontrou o calendário deste closer. Os horários não estão livres.';
    }
    return 'Não foi possível confirmar a agenda deste closer. Os horários não estão livres.';
  }
  if (input.source === 'sdr_token') {
    return 'Agenda deste closer, lida pelo seu Google. "Você ocupado" avisa a sua agenda e não bloqueia o horário.';
  }
  return null;
}

/**
 * 23P01/23505: outro agendamento ganhou a vaga (clique duplo ou outra aba).
 * 42P01/PGRST205: a migration ainda não foi aplicada. Aí a checagem das
 * reuniões do app continua, mas deixa de ser atômica.
 */
export function interpretHoldError(error: { code?: string; message?: string } | null | undefined): 'ok' | 'conflict' | 'table_missing' | 'other' {
  if (!error) return 'ok';
  const code = error.code ?? '';
  if (code === '23P01' || code === '23505') return 'conflict';
  const message = (error.message ?? '').toLowerCase();
  const missing = code === '42P01'
    || code === 'PGRST205'
    || (message.includes('closer_booking_holds') && (message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache')));
  return missing ? 'table_missing' : 'other';
}

export function fallbackBlocks(appMeetings: BusyInterval[], start: Date, end: Date, excludeLeadId?: string): boolean {
  return appMeetings.some((meeting) => {
    if (excludeLeadId && meeting.leadId && meeting.leadId === excludeLeadId) return false;
    return intervalsOverlap(start, end, meeting);
  });
}

export function closerSlotMoved(input: {
  previousCloserId: string | null;
  previousStart: string | null;
  nextCloserId: string;
  nextStart: string;
}): boolean {
  if (input.previousCloserId !== input.nextCloserId) return true;
  const previous = meetingInstant(input.previousStart);
  const next = meetingInstant(input.nextStart);
  if (!previous || !next) return true;
  return previous.getTime() !== next.getTime();
}

export function brtDateKeyFromInstant(date: Date): string {
  const shifted = new Date(date.getTime() - BRT_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
