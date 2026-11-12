import { meetingInstant, type BusyInterval } from '@/features/meetings/closer-availability.logic';

/**
 * Leitura de `events.list` do Google Calendar para a grade do cockpit.
 *
 * Só entra o que de fato ocupa o closer: cancelado, "disponível"
 * (transparent) e convite recusado por ele ficam de fora. Evento privado ou
 * sem título vira "Privado", para o pré-vendas não ver o que o closer
 * escondeu.
 */

export const PRIVATE_EVENT_TITLE = 'Privado';

export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEventAttendee {
  email?: string;
  self?: boolean;
  responseStatus?: string;
}

export interface GoogleCalendarEventItem {
  id?: string;
  summary?: string;
  status?: string;
  visibility?: string;
  transparency?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  attendees?: GoogleEventAttendee[];
}

/** Campos pedidos ao Google. Nada de descrição, local, anexos ou convidados além do próprio closer. */
export const CALENDAR_EVENT_FIELDS =
  'items(id,summary,status,visibility,transparency,start,end,attendees(email,self,responseStatus)),nextPageToken';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Dia inteiro: 00:00 em America/Sao_Paulo, sem depender do fuso do processo. */
function allDayInstant(value: string | undefined): Date | null {
  if (!value || !DATE_ONLY.test(value)) return null;
  return meetingInstant(`${value}T00:00:00`);
}

function eventInstant(time: GoogleEventTime | undefined): Date | null {
  if (!time) return null;
  if (time.dateTime) return meetingInstant(time.dateTime);
  return allDayInstant(time.date);
}

function declinedByCloser(item: GoogleCalendarEventItem, closerEmail?: string | null): boolean {
  const email = closerEmail?.trim().toLowerCase() ?? '';
  return (item.attendees ?? []).some((attendee) => {
    if (attendee.responseStatus !== 'declined') return false;
    if (attendee.self === true) return true;
    return !!email && attendee.email?.trim().toLowerCase() === email;
  });
}

export function eventTitle(item: GoogleCalendarEventItem): string {
  const visibility = item.visibility ?? '';
  if (visibility === 'private' || visibility === 'confidential') return PRIVATE_EVENT_TITLE;
  const summary = item.summary?.trim() ?? '';
  return summary ? (item.summary as string) : PRIVATE_EVENT_TITLE;
}

export function parseCalendarEvents(
  items: GoogleCalendarEventItem[] | null | undefined,
  options: { closerEmail?: string | null } = {},
): BusyInterval[] {
  const out: BusyInterval[] = [];
  for (const item of items ?? []) {
    if (item.status === 'cancelled') continue;
    if (item.transparency === 'transparent') continue;
    if (declinedByCloser(item, options.closerEmail)) continue;
    const start = eventInstant(item.start);
    const end = eventInstant(item.end);
    if (!start || !end || end.getTime() <= start.getTime()) continue;
    const interval: BusyInterval = {
      start: start.toISOString(),
      end: end.toISOString(),
      title: eventTitle(item),
    };
    if (item.id) interval.eventId = item.id;
    out.push(interval);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * 403 por escopo: conexão antiga do closer, feita só com `calendar.freebusy`.
 * O Google responde `insufficientPermissions` e, nas versões novas, também
 * `ACCESS_TOKEN_SCOPE_INSUFFICIENT` com status `PERMISSION_DENIED`.
 */
export function isInsufficientCalendarScopeError(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const text = typeof body === 'string' ? body : safeStringify(body);
  if (!text) return false;
  return /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/i.test(text);
}

/**
 * Como os títulos foram lidos. `ok`: events.list respondeu. Os demais caíram
 * no freeBusy (sem título). `insufficient_scope` é a conexão antiga, que
 * precisa reconectar para ver títulos.
 */
export type CalendarTitlesStatus = 'ok' | 'insufficient_scope' | 'no_access' | 'failed' | 'not_tried';

/** Lê o `kind` do CalendarEventsError (calendar.service) sem importar o serviço. */
export function titlesStatusFromError(err: unknown): CalendarTitlesStatus {
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'CalendarEventsError') {
    const kind = (err as { kind?: unknown }).kind;
    if (kind === 'insufficient_scope') return 'insufficient_scope';
    if (kind === 'no_access') return 'no_access';
  }
  return 'failed';
}

/** 403/404 que não é escopo: quem lê não tem acesso aos detalhes desta agenda. */
export function isCalendarAccessDeniedError(status: number, body: unknown): boolean {
  if (status === 404) return true;
  return status === 403 && !isInsufficientCalendarScopeError(status, body);
}

function safeStringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
