import { describe, expect, it } from 'vitest';

import { computeFreeSlots, conflictMatchesRequest, decideExternalChange, deriveEventId, slotLabelPt } from './slots';

const now = new Date('2026-09-21T12:00:00-03:00'); // segunda, 12h BRT

describe('computeFreeSlots', () => {
  it('respeita antecedência, janela, dias úteis e 1 por dia', () => {
    const slots = computeFreeSlots({ now, count: 2 });
    expect(slots).toHaveLength(2);
    expect(slots[0]!.start.toISOString()).toBe(new Date('2026-09-21T15:00:00-03:00').toISOString()); // +3h → 15h hoje
    expect(slots[1]!.start.toISOString()).toBe(new Date('2026-09-22T09:00:00-03:00').toISOString()); // amanhã 9h
  });
  it('pula ocupados do freeBusy e reservados em calendar_slots', () => {
    const slots = computeFreeSlots({
      now, count: 1,
      busy: [{ start: '2026-09-21T15:00:00-03:00', end: '2026-09-21T16:00:00-03:00' }],
      reserved: [{ start: '2026-09-21T16:00:00-03:00', end: '2026-09-21T16:45:00-03:00' }],
    });
    expect(slots[0]!.start.toISOString()).toBe(new Date('2026-09-22T09:00:00-03:00').toISOString());
  });
  it('pula fim de semana e feriado', () => {
    const sexta = new Date('2026-09-25T16:30:00-03:00');
    const slots = computeFreeSlots({ now: sexta, count: 1, holidays: ['2026-09-28'] });
    expect(slots[0]!.start.toISOString()).toBe(new Date('2026-09-29T09:00:00-03:00').toISOString());
  });
  it('rótulo em português', () => {
    expect(slotLabelPt(new Date('2026-09-23T14:00:00-03:00'))).toBe('quarta, 23/09 às 14h00');
  });
});

describe('deriveEventId', () => {
  it('determinístico por solicitação+versão e válido para o Google (base32hex)', () => {
    const a = deriveEventId('req-1', 1);
    expect(a).toBe(deriveEventId('req-1', 1));
    expect(a).not.toBe(deriveEventId('req-1', 2));
    expect(a).toMatch(/^[0-9a-v]{5,1024}$/);
  });
});

const request = { id: 'req-1', slot_start: '2026-09-23T14:00:00-03:00', slot_end: '2026-09-23T14:45:00-03:00', google_event_id: 'bdrx' };

describe('decideExternalChange', () => {
  it('evento sumiu ou cancelado → conflito (humano decide)', () => {
    expect(decideExternalChange({ request, event: null }).acao).toBe('conflito');
    expect(decideExternalChange({ request, event: { status: 'cancelled', startTime: request.slot_start, endTime: request.slot_end } }).acao).toBe('conflito');
  });
  it('closer moveu com o cliente → adotar o novo horário, sem reoferta', () => {
    const d = decideExternalChange({ request, event: { status: 'confirmed', startTime: '2026-09-24T10:00:00-03:00', endTime: '2026-09-24T10:45:00-03:00', extendedProperties: { meeting_request_id: 'req-1' } } });
    expect(d.acao).toBe('adotar');
  });
  it('mesmo horário → ok; tag de outra solicitação → conflito', () => {
    expect(decideExternalChange({ request, event: { status: 'confirmed', startTime: request.slot_start, endTime: request.slot_end } }).acao).toBe('ok');
    expect(decideExternalChange({ request, event: { status: 'confirmed', startTime: request.slot_start, endTime: request.slot_end, extendedProperties: { meeting_request_id: 'outra' } } }).acao).toBe('conflito');
  });
});

describe('conflictMatchesRequest (409 não é sucesso automático)', () => {
  const ok = { status: 'confirmed', startTime: request.slot_start, endTime: request.slot_end, extendedProperties: { meeting_request_id: 'req-1' }, attendees: ['joao@arroz.com'] };
  it('mesma solicitação, horário, participante e não cancelado → sucesso idempotente', () => {
    expect(conflictMatchesRequest({ request, event: ok, attendeeEmail: 'Joao@Arroz.com' })).toBe(true);
  });
  it('outra solicitação, horário diferente, cancelado ou sem o lead → não confirma', () => {
    expect(conflictMatchesRequest({ request, event: { ...ok, extendedProperties: { meeting_request_id: 'x' } } })).toBe(false);
    expect(conflictMatchesRequest({ request, event: { ...ok, startTime: '2026-09-23T15:00:00-03:00' } })).toBe(false);
    expect(conflictMatchesRequest({ request, event: { ...ok, status: 'cancelled' } })).toBe(false);
    expect(conflictMatchesRequest({ request, event: ok, attendeeEmail: 'outro@x.com' })).toBe(false);
  });
});
