import { createHash } from 'node:crypto';

/** BDR-4 — regras puras da agenda (sem I/O). Fuso fixo America/Sao_Paulo (-03:00). */

export interface Interval { start: string | Date; end: string | Date }
export interface Slot { start: Date; end: Date }

const BRT_OFFSET_MIN = -180;

function toBrtParts(d: Date) {
  const shifted = new Date(d.getTime() + BRT_OFFSET_MIN * 60000);
  return { y: shifted.getUTCFullYear(), m: shifted.getUTCMonth(), day: shifted.getUTCDate(), h: shifted.getUTCHours(), min: shifted.getUTCMinutes(), dow: shifted.getUTCDay() };
}
function fromBrt(y: number, m: number, day: number, h: number, min = 0): Date {
  return new Date(Date.UTC(y, m, day, h, min) - BRT_OFFSET_MIN * 60000);
}
function overlaps(a: Slot, b: Interval): boolean {
  return a.start < new Date(b.end) && new Date(b.start) < a.end;
}

/**
 * Horários livres: dias úteis, janela [hourStart, hourEnd) BRT, duração fixa,
 * antecedência mínima, no máximo 1 por dia, excluindo ocupados (freeBusy) e
 * reservados (calendar_slots), opcionalmente ignorando feriados (YYYY-MM-DD).
 */
export function computeFreeSlots({
  now, busy = [], reserved = [], count = 2, durationMin = 45, hourStart = 9, hourEnd = 17,
  leadHours = 3, horizonDays = 10, stepMin = 60, onePerDay = true, holidays = [],
}: {
  now: Date; busy?: Interval[]; reserved?: Interval[]; count?: number; durationMin?: number;
  hourStart?: number; hourEnd?: number; leadHours?: number; horizonDays?: number; stepMin?: number;
  onePerDay?: boolean; holidays?: string[];
}): Slot[] {
  const out: Slot[] = [];
  const earliest = new Date(now.getTime() + leadHours * 3600000);
  const base = toBrtParts(now);
  const blocked = [...busy, ...reserved];
  for (let d = 0; d <= horizonDays && out.length < count; d++) {
    const dayStart = fromBrt(base.y, base.m, base.day + d, hourStart);
    const p = toBrtParts(dayStart);
    if (p.dow === 0 || p.dow === 6) continue;
    const iso = `${p.y}-${String(p.m + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
    if (holidays.includes(iso)) continue;
    let tookToday = false;
    for (let mins = hourStart * 60; mins + durationMin <= hourEnd * 60 && out.length < count; mins += stepMin) {
      const start = fromBrt(p.y, p.m, p.day, Math.floor(mins / 60), mins % 60);
      const end = new Date(start.getTime() + durationMin * 60000);
      if (start < earliest) continue;
      const slot = { start, end };
      if (blocked.some((b) => overlaps(slot, b))) continue;
      out.push(slot);
      tookToday = true;
      if (onePerDay && tookToday) break;
    }
  }
  return out;
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "quarta, 24/09 às 14h00" */
export function slotLabelPt(start: Date): string {
  const p = toBrtParts(start);
  return `${DIAS[p.dow]}, ${String(p.day).padStart(2, '0')}/${String(p.m + 1).padStart(2, '0')} às ${String(p.h).padStart(2, '0')}h${String(p.min).padStart(2, '0')}`;
}

/**
 * Id de evento determinístico por solicitação + versão. O Google aceita ids do
 * cliente em base32hex (0-9, a-v), 5-1024 caracteres; hex ⊂ base32hex.
 */
export function deriveEventId(meetingRequestId: string, versao: number): string {
  const hex = createHash('sha1').update(`${meetingRequestId}:${versao}`).digest('hex');
  return `bdr${hex}`;
}

export type ExternalChangeDecision =
  | { acao: 'ok' }
  | { acao: 'adotar'; novoStart: Date; novoEnd: Date }
  | { acao: 'conflito'; motivo: string };

/**
 * Evento lido do calendário vs. solicitação: sumiu/cancelado → conflito (humano
 * decide); movido pelo closer → adotar o novo horário; igual → ok.
 * Alteração externa é reconciliação, nunca reoferta automática.
 */
export function decideExternalChange({ request, event, toleranceMin = 1 }: {
  request: { slot_start: string | Date; slot_end: string | Date; google_event_id: string | null; id: string };
  event: { status: string; startTime: string; endTime: string; extendedProperties?: Record<string, string> } | null;
  toleranceMin?: number;
}): ExternalChangeDecision {
  if (!event) return { acao: 'conflito', motivo: 'evento não existe mais no calendário' };
  if (event.status === 'cancelled') return { acao: 'conflito', motivo: 'evento cancelado no calendário' };
  const tag = event.extendedProperties?.meeting_request_id;
  if (tag && tag !== request.id) return { acao: 'conflito', motivo: `evento pertence a outra solicitação (${tag})` };
  const es = new Date(event.startTime), ee = new Date(event.endTime);
  const rs = new Date(request.slot_start), re = new Date(request.slot_end);
  const tol = toleranceMin * 60000;
  if (Math.abs(es.getTime() - rs.getTime()) <= tol && Math.abs(ee.getTime() - re.getTime()) <= tol) return { acao: 'ok' };
  return { acao: 'adotar', novoStart: es, novoEnd: ee };
}

/** 409 na criação: só é sucesso se o evento existente for da mesma solicitação, horário e não cancelado. */
export function conflictMatchesRequest({ request, event, attendeeEmail }: {
  request: { id: string; slot_start: string | Date; slot_end: string | Date };
  event: { status: string; startTime: string; endTime: string; extendedProperties?: Record<string, string>; attendees?: string[] } | null;
  attendeeEmail?: string | null;
}): boolean {
  if (!event || event.status === 'cancelled') return false;
  if (event.extendedProperties?.meeting_request_id !== request.id) return false;
  const d = decideExternalChange({ request: { ...request, google_event_id: null }, event });
  if (d.acao !== 'ok') return false;
  if (attendeeEmail && event.attendees && !event.attendees.includes(attendeeEmail.toLowerCase())) return false;
  return true;
}
