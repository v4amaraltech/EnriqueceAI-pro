import { describe, expect, it } from 'vitest';

import { MEETING_DURATION_MIN } from './meeting-duration';
import { buildCloserWeekSlots, SLOT_DURATION_MIN, slotSelectable, startOfWorkWeek } from '@/features/cockpit/utils/week-slots';

import {
  availabilityNotice,
  bookingDecision,
  chooseCalendarSource,
  classifySlot,
  closerSlotMoved,
  fallbackBlocks,
  interpretFreeBusyEntry,
  interpretHoldError,
  lookupFreeBusyEntry,
  meetingInstant,
} from './closer-availability.logic';

const start = new Date('2026-11-16T14:00:00.000Z');
const end = new Date('2026-11-16T15:00:00.000Z');

describe('resolução do calendário do closer', () => {
  it('usa o token do closer quando ele tem usuário e conexão', () => {
    expect(chooseCalendarSource({
      closerUserId: 'user-1',
      closerHasConnection: true,
      sdrHasConnection: true,
    })).toBe('closer_token');
  });

  it('plano B: sem conexão do closer, consulta com o token do SDR', () => {
    expect(chooseCalendarSource({
      closerUserId: null,
      closerHasConnection: false,
      sdrHasConnection: true,
    })).toBe('sdr_token');
    expect(chooseCalendarSource({
      closerUserId: 'user-1',
      closerHasConnection: false,
      sdrHasConnection: true,
    })).toBe('sdr_token');
  });

  it('plano C: sem conexão dos dois lados', () => {
    expect(chooseCalendarSource({
      closerUserId: null,
      closerHasConnection: false,
      sdrHasConnection: false,
    })).toBe('none');
  });
});

describe('freeBusy desconhecido não é livre', () => {
  it('notFound com busy vazio continua desconhecido', () => {
    const read = interpretFreeBusyEntry({ busy: [], errors: [{ reason: 'notFound' }] });
    expect(read.known).toBe(false);
    if (!read.known) expect(read.reason).toBe('notFound');
    expect(classifySlot({
      start,
      end,
      calendarKnown: read.known,
      calendarBusy: read.known ? read.busy : [],
      appMeetings: [],
      holiday: false,
    })).toBe('unknown');
  });

  it('calendário ausente na resposta não vira lista vazia livre', () => {
    const calendars = { 'outro@firma.com': { busy: [] } };
    const read = interpretFreeBusyEntry(lookupFreeBusyEntry(calendars, 'closer@firma.com'));
    expect(read).toEqual({ known: false, reason: 'sem_resposta' });
    expect(classifySlot({
      start,
      end,
      calendarKnown: false,
      calendarBusy: [],
      appMeetings: [],
      holiday: false,
    })).toBe('unknown');
  });

  it('falha do freeBusy não classifica o horário como livre', () => {
    expect(bookingDecision('unknown').allow).toBe(false);
    expect(bookingDecision('unknown').code).toBe('CLOSER_UNKNOWN');
    expect(availabilityNotice({
      closerSelected: true,
      source: 'none',
      calendarKnown: false,
      reason: 'freebusy_failed',
    })).toContain('não estão livres');
  });

  it('busy vazio sem erro é agenda confirmada e livre', () => {
    const read = interpretFreeBusyEntry({ busy: [] });
    expect(read).toEqual({ known: true, busy: [] });
    expect(classifySlot({
      start,
      end,
      calendarKnown: true,
      calendarBusy: [],
      appMeetings: [],
      holiday: false,
    })).toBe('free');
  });

  it('acha o calendário ignorando maiúsculas', () => {
    const entry = lookupFreeBusyEntry(
      { 'Closer@Firma.com': { busy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z' }] } },
      'closer@firma.com',
    );
    const read = interpretFreeBusyEntry(entry);
    expect(read.known).toBe(true);
    if (read.known) expect(read.busy).toHaveLength(1);
  });
});

describe('feriado, reunião do app e trava', () => {
  it('feriado não fica livre nem selecionável', () => {
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: [],
      appBusy: [],
      holidays: ['2026-11-20'],
      sdrBusy: [],
      now: new Date('2026-11-16T12:00:00.000Z'),
    });
    const friday = slots.filter((slot) => slot.dayIndex === 4);
    expect(friday.length).toBeGreaterThan(0);
    expect(friday.every((slot) => slot.holiday && slot.state === 'busy' && !slotSelectable(slot))).toBe(true);
    expect(classifySlot({
      start: new Date('2026-11-20T12:00:00.000Z'),
      end: new Date('2026-11-20T13:00:00.000Z'),
      calendarKnown: true,
      calendarBusy: [],
      appMeetings: [],
      holiday: true,
    })).toBe('holiday');
    expect(bookingDecision('holiday').allow).toBe(false);
  });

  it('reunião já marcada no app ocupa mesmo com o Google livre', () => {
    const kind = classifySlot({
      start,
      end,
      calendarKnown: true,
      calendarBusy: [],
      appMeetings: [{ start: '2026-11-16T14:30:00.000Z', end: '2026-11-16T15:30:00.000Z', leadId: 'lead-2' }],
      holiday: false,
    });
    expect(kind).toBe('busy');
    expect(bookingDecision(kind).allow).toBe(false);
  });

  it('reunião do app continua ocupada quando o calendário é desconhecido', () => {
    expect(classifySlot({
      start,
      end,
      calendarKnown: false,
      calendarBusy: [],
      appMeetings: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z' }],
      holiday: false,
    })).toBe('busy');
  });

  it('conflito da trava bloqueia e tabela ausente cai no fallback das reuniões', () => {
    expect(interpretHoldError({ code: '23P01', message: 'conflicting key' })).toBe('conflict');
    expect(interpretHoldError({ code: '23505', message: 'duplicate key' })).toBe('conflict');
    expect(interpretHoldError({ code: '42P01', message: 'relation closer_booking_holds does not exist' })).toBe('table_missing');
    expect(interpretHoldError({ code: 'PGRST205', message: 'Could not find the table closer_booking_holds in the schema cache' })).toBe('table_missing');
    expect(interpretHoldError(null)).toBe('ok');
    expect(interpretHoldError({ code: '42501', message: 'permission denied' })).toBe('other');

    const meetings = [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', leadId: 'lead-2' }];
    expect(fallbackBlocks(meetings, start, end)).toBe(true);
    expect(fallbackBlocks(meetings, start, end, 'lead-2')).toBe(false);
    expect(fallbackBlocks(meetings, new Date('2026-11-16T15:00:00.000Z'), new Date('2026-11-16T16:00:00.000Z'))).toBe(false);
  });

  it('a grade inteira fica desconhecida quando o freeBusy não confirma', () => {
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: false,
      calendarBusy: [],
      appBusy: [],
      holidays: [],
      sdrBusy: [],
      now: new Date('2026-11-16T12:00:00.000Z'),
    });
    const future = slots.filter((slot) => !slot.past);
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((slot) => slot.state === 'unknown' && !slotSelectable(slot))).toBe(true);
    expect(future.some((slot) => slotSelectable(slot))).toBe(false);
  });

  it('a ocupação do SDR não tira o horário livre do closer', () => {
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: [],
      appBusy: [],
      holidays: [],
      sdrBusy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z' }],
      now: new Date('2026-11-16T12:00:00.000Z'),
    });
    const eleven = slots.find((slot) => slot.dayIndex === 0 && slot.hour === 11);
    expect(eleven?.state).toBe('free');
    expect(eleven?.sdrBusy).toBe(true);
    expect(eleven && slotSelectable(eleven)).toBe(true);
  });
});

describe('duração e remarcação', () => {
  it('a duração do cockpit é a constante de 60 minutos', () => {
    expect(MEETING_DURATION_MIN).toBe(60);
    expect(SLOT_DURATION_MIN).toBe(MEETING_DURATION_MIN);
    expect(meetingInstant('2026-11-12T15:00:00')?.toISOString()).toBe('2026-11-12T18:00:00.000Z');
  });

  it('o mesmo closer no mesmo horário não abre outra trava', () => {
    expect(closerSlotMoved({
      previousCloserId: 'closer-1',
      previousStart: '2026-11-12T15:00:00',
      nextCloserId: 'closer-1',
      nextStart: '2026-11-12T15:00:00',
    })).toBe(false);
    expect(closerSlotMoved({
      previousCloserId: 'closer-1',
      previousStart: '2026-11-12T15:00:00',
      nextCloserId: 'closer-1',
      nextStart: '2026-11-12T16:00:00',
    })).toBe(true);
  });
});

describe('ocupado no Google x reunião do Enriquece', () => {
  const googleBusy = [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', title: 'Dentista' }];
  const appMeeting = [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', leadId: 'lead-2' }];

  it('ocupação só do Google é calendar_busy, separada da reunião do app', () => {
    expect(classifySlot({ start, end, calendarKnown: true, calendarBusy: googleBusy, appMeetings: [], holiday: false })).toBe('calendar_busy');
    expect(classifySlot({ start, end, calendarKnown: true, calendarBusy: googleBusy, appMeetings: appMeeting, holiday: false })).toBe('busy');
    expect(classifySlot({ start, end, calendarKnown: true, calendarBusy: googleBusy, appMeetings: appMeeting, holiday: true })).toBe('holiday');
    expect(classifySlot({ start, end, calendarKnown: false, calendarBusy: googleBusy, appMeetings: [], holiday: false })).toBe('unknown');
  });

  it('Google ocupado: bloqueia sem a flag e permite com allowOverlap', () => {
    expect(bookingDecision('calendar_busy')).toMatchObject({ allow: false, code: 'CLOSER_BUSY' });
    expect(bookingDecision('calendar_busy', { allowOverlap: false })).toMatchObject({ allow: false, code: 'CLOSER_BUSY' });
    expect(bookingDecision('calendar_busy', { allowOverlap: true })).toMatchObject({ allow: true });
  });

  it('reunião do app, feriado e desconhecido continuam bloqueados mesmo com allowOverlap', () => {
    const app = bookingDecision('busy', { allowOverlap: true });
    expect(app).toMatchObject({ allow: false, code: 'CLOSER_BUSY' });
    expect(app.error).toContain('Enriquece');
    expect(bookingDecision('holiday', { allowOverlap: true })).toMatchObject({ allow: false, code: 'CLOSER_HOLIDAY' });
    expect(bookingDecision('unknown', { allowOverlap: true })).toMatchObject({ allow: false, code: 'CLOSER_UNKNOWN' });
    expect(bookingDecision('free', { allowOverlap: true })).toMatchObject({ allow: true });
    expect(bookingDecision('free')).toMatchObject({ allow: true });
  });

  it('slotSelectable: Google ocupado futuro sim; app, feriado, passado e sem dados não', () => {
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const now = new Date('2026-11-16T12:30:00.000Z');
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: [
        { start: '2026-11-16T12:00:00.000Z', end: '2026-11-16T13:00:00.000Z', title: 'Passado' },
        { start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', title: 'Dentista' },
        { start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z', title: 'Por baixo da reunião' },
      ],
      appBusy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }],
      holidays: ['2026-11-20'],
      sdrBusy: [],
      now,
    });
    const at = (day: number, hour: number) => slots.find((slot) => slot.dayIndex === day && slot.hour === hour);
    const google = at(0, 11);
    expect(google).toMatchObject({ state: 'busy', busySource: 'calendar', title: 'Dentista', extraEventCount: 0 });
    expect(google && slotSelectable(google)).toBe(true);
    const app = at(0, 12);
    expect(app?.busySource).toBe('app');
    expect(app?.title).toBe('Por baixo da reunião');
    expect(app && slotSelectable(app)).toBe(false);
    const past = at(0, 9);
    expect(past?.busySource).toBe('calendar');
    expect(past && slotSelectable(past)).toBe(false);
    const holiday = at(4, 11);
    expect(holiday?.busySource).toBe('holiday');
    expect(holiday?.title).toBeUndefined();
    expect(holiday && slotSelectable(holiday)).toBe(false);

    const unknown = buildCloserWeekSlots(week, {
      calendarKnown: false,
      calendarBusy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', title: 'Dentista' }],
      appBusy: [],
      holidays: [],
      sdrBusy: [],
      now,
    }).find((slot) => slot.dayIndex === 0 && slot.hour === 11);
    expect(unknown?.state).toBe('unknown');
    expect(unknown?.title).toBeUndefined();
    expect(unknown && slotSelectable(unknown)).toBe(false);
  });

  it('freeBusy sem título continua ocupado selecionável, sem título', () => {
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slot = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z' }],
      appBusy: [],
      holidays: [],
      sdrBusy: [],
      now: new Date('2026-11-16T12:00:00.000Z'),
    }).find((item) => item.dayIndex === 0 && item.hour === 11);
    expect(slot?.busySource).toBe('calendar');
    expect(slot?.title).toBeUndefined();
    expect(slot?.extraEventCount).toBeUndefined();
    expect(slot && slotSelectable(slot)).toBe(true);
  });
});
