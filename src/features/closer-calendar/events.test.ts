import { describe, expect, it } from 'vitest';

import { buildCloserWeekSlots, slotSelectable, startOfWorkWeek } from '@/features/cockpit/utils/week-slots';

import {
  eventTitle,
  isCalendarAccessDeniedError,
  isInsufficientCalendarScopeError,
  parseCalendarEvents,
  PRIVATE_EVENT_TITLE,
  titlesStatusFromError,
} from './events';

const CLOSER = 'closer@firma.com';

describe('parse do events.list', () => {
  it('evento normal vira intervalo com o título como está', () => {
    const busy = parseCalendarEvents([
      {
        id: 'ev-1',
        summary: 'Reunião com cliente Acme',
        status: 'confirmed',
        start: { dateTime: '2026-11-16T11:00:00-03:00' },
        end: { dateTime: '2026-11-16T12:00:00-03:00' },
      },
    ]);
    expect(busy).toEqual([
      { start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', title: 'Reunião com cliente Acme', eventId: 'ev-1' },
    ]);
  });

  it('privado, confidencial e sem título viram "Privado"', () => {
    const base = { start: { dateTime: '2026-11-16T14:00:00Z' }, end: { dateTime: '2026-11-16T15:00:00Z' } };
    expect(eventTitle({ ...base, summary: 'Médico', visibility: 'private' })).toBe(PRIVATE_EVENT_TITLE);
    expect(eventTitle({ ...base, summary: 'Médico', visibility: 'confidential' })).toBe(PRIVATE_EVENT_TITLE);
    expect(eventTitle({ ...base })).toBe(PRIVATE_EVENT_TITLE);
    expect(eventTitle({ ...base, summary: '   ' })).toBe(PRIVATE_EVENT_TITLE);
    expect(eventTitle({ ...base, summary: 'Daily', visibility: 'default' })).toBe('Daily');
    expect(eventTitle({ ...base, summary: 'Daily', visibility: 'public' })).toBe('Daily');
    const parsed = parseCalendarEvents([
      { ...base, summary: 'Segredo', visibility: 'private' },
      { ...base, summary: 'Segredo 2', visibility: 'confidential' },
      { ...base },
    ]);
    expect(parsed.map((item) => item.title)).toEqual(['Privado', 'Privado', 'Privado']);
    expect(JSON.stringify(parsed)).not.toContain('Segredo');
  });

  it('dia inteiro usa o fim exclusivo do Google e ocupa o dia em BRT', () => {
    const busy = parseCalendarEvents([
      { summary: 'Férias', start: { date: '2026-11-17' }, end: { date: '2026-11-18' } },
    ]);
    expect(busy).toEqual([{ start: '2026-11-17T03:00:00.000Z', end: '2026-11-18T03:00:00.000Z', title: 'Férias' }]);

    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: busy,
      appBusy: [],
      holidays: [],
      sdrBusy: [],
      now: new Date('2026-11-16T12:00:00.000Z'),
    });
    const tuesday = slots.filter((slot) => slot.dayIndex === 1);
    expect(tuesday.every((slot) => slot.busySource === 'calendar' && slot.title === 'Férias')).toBe(true);
    const monday = slots.filter((slot) => slot.dayIndex === 0);
    const wednesday = slots.filter((slot) => slot.dayIndex === 2);
    expect(monday.every((slot) => slot.state === 'free')).toBe(true);
    expect(wednesday.every((slot) => slot.state === 'free')).toBe(true);
  });

  it('dia inteiro de vários dias cobre até o dia anterior ao end.date', () => {
    const busy = parseCalendarEvents([{ summary: 'Viagem', start: { date: '2026-11-18' }, end: { date: '2026-11-20' } }]);
    expect(busy[0]).toMatchObject({ start: '2026-11-18T03:00:00.000Z', end: '2026-11-20T03:00:00.000Z' });
  });

  it('ignora cancelados, transparentes e recusados pelo closer', () => {
    const time = { start: { dateTime: '2026-11-16T14:00:00Z' }, end: { dateTime: '2026-11-16T15:00:00Z' } };
    const busy = parseCalendarEvents([
      { ...time, summary: 'Cancelado', status: 'cancelled' },
      { ...time, summary: 'Disponível', transparency: 'transparent' },
      { ...time, summary: 'Recusei', attendees: [{ email: 'outro@x.com', responseStatus: 'accepted' }, { self: true, responseStatus: 'declined' }] },
      { ...time, summary: 'Recusei por e-mail', attendees: [{ email: 'Closer@Firma.com', responseStatus: 'declined' }] },
      { ...time, summary: 'Outro recusou', attendees: [{ email: 'outro@x.com', responseStatus: 'declined' }, { self: true, responseStatus: 'accepted' }] },
      { ...time, summary: 'Opaco', transparency: 'opaque' },
    ], { closerEmail: CLOSER });
    expect(busy.map((item) => item.title)).toEqual(['Outro recusou', 'Opaco']);
  });

  it('sem e-mail conhecido, recusa por e-mail de terceiro não some', () => {
    const busy = parseCalendarEvents([
      {
        summary: 'Convite',
        start: { dateTime: '2026-11-16T14:00:00Z' },
        end: { dateTime: '2026-11-16T15:00:00Z' },
        attendees: [{ email: CLOSER, responseStatus: 'declined' }],
      },
    ]);
    expect(busy).toHaveLength(1);
  });

  it('descarta horário inválido ou com fim antes do início', () => {
    expect(parseCalendarEvents([
      { summary: 'Sem fim', start: { dateTime: '2026-11-16T14:00:00Z' } },
      { summary: 'Invertido', start: { dateTime: '2026-11-16T15:00:00Z' }, end: { dateTime: '2026-11-16T14:00:00Z' } },
      { summary: 'Data ruim', start: { date: '16/11/2026' }, end: { date: '17/11/2026' } },
    ])).toEqual([]);
    expect(parseCalendarEvents(undefined)).toEqual([]);
  });

  it('vários eventos no mesmo horário: primeiro título e +N na grade', () => {
    const busy = parseCalendarEvents([
      { summary: 'Segundo', start: { dateTime: '2026-11-16T14:30:00Z' }, end: { dateTime: '2026-11-16T15:00:00Z' } },
      { summary: 'Primeiro', start: { dateTime: '2026-11-16T14:00:00Z' }, end: { dateTime: '2026-11-16T14:30:00Z' } },
      { summary: 'Terceiro', visibility: 'private', start: { dateTime: '2026-11-16T14:45:00Z' }, end: { dateTime: '2026-11-16T16:00:00Z' } },
    ]);
    const week = startOfWorkWeek(new Date('2026-11-16T15:00:00.000Z'));
    const slots = buildCloserWeekSlots(week, {
      calendarKnown: true,
      calendarBusy: busy,
      appBusy: [],
      holidays: [],
      sdrBusy: [],
      now: new Date('2026-11-16T12:00:00.000Z'),
    });
    const eleven = slots.find((slot) => slot.dayIndex === 0 && slot.hour === 11);
    expect(eleven?.title).toBe('Primeiro');
    expect(eleven?.extraEventCount).toBe(2);
    expect(eleven?.busySource).toBe('calendar');
    expect(eleven && slotSelectable(eleven)).toBe(true);
    const twelve = slots.find((slot) => slot.dayIndex === 0 && slot.hour === 12);
    expect(twelve?.title).toBe('Privado');
    expect(twelve?.extraEventCount).toBe(0);
  });
});

describe('erros do events.list', () => {
  const scopeBody = JSON.stringify({
    error: {
      code: 403,
      message: 'Request had insufficient authentication scopes.',
      errors: [{ reason: 'insufficientPermissions', domain: 'global' }],
      status: 'PERMISSION_DENIED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
    },
  });

  it('403 de escopo é detectado pelo corpo, em texto ou objeto', () => {
    expect(isInsufficientCalendarScopeError(403, scopeBody)).toBe(true);
    expect(isInsufficientCalendarScopeError(403, JSON.parse(scopeBody))).toBe(true);
    expect(isInsufficientCalendarScopeError(403, { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } })).toBe(true);
  });

  it('403 sem escopo, 404 e outros status não são escopo', () => {
    expect(isInsufficientCalendarScopeError(403, { error: { errors: [{ reason: 'forbidden' }] } })).toBe(false);
    expect(isInsufficientCalendarScopeError(401, scopeBody)).toBe(false);
    expect(isInsufficientCalendarScopeError(500, '')).toBe(false);
    expect(isInsufficientCalendarScopeError(403, null)).toBe(false);
  });

  it('falta de acesso: 404 ou 403 que não é escopo', () => {
    expect(isCalendarAccessDeniedError(404, '')).toBe(true);
    expect(isCalendarAccessDeniedError(403, '{"error":{"errors":[{"reason":"forbidden"}]}}')).toBe(true);
    expect(isCalendarAccessDeniedError(403, scopeBody)).toBe(false);
    expect(isCalendarAccessDeniedError(500, '')).toBe(false);
  });

  it('traduz o erro do serviço no estado dos títulos', () => {
    expect(titlesStatusFromError(Object.assign(new Error('x'), { name: 'CalendarEventsError', kind: 'insufficient_scope' }))).toBe('insufficient_scope');
    expect(titlesStatusFromError(Object.assign(new Error('x'), { name: 'CalendarEventsError', kind: 'no_access' }))).toBe('no_access');
    expect(titlesStatusFromError(Object.assign(new Error('x'), { name: 'CalendarEventsError', kind: 'failed' }))).toBe('failed');
    expect(titlesStatusFromError(new Error('rede'))).toBe('failed');
    expect(titlesStatusFromError(null)).toBe('failed');
  });
});
