import { beforeEach, describe, expect, it, vi } from 'vitest';

const listEvents = vi.fn();
const freeBusy = vi.fn();

class FakeCalendarEventsError extends Error {
  constructor(public readonly kind: string, public readonly status: number | null) {
    super('events.list falhou');
    this.name = 'CalendarEventsError';
  }
}

vi.mock('@/features/integrations/services/calendar.service', () => ({
  listCalendarEventsWithToken: (...args: unknown[]) => listEvents(...args),
  queryFreeBusyWithToken: (...args: unknown[]) => freeBusy(...args),
}));
vi.mock('@/lib/security/encryption', () => ({ decrypt: () => 'access-token' }));
vi.mock('./db', () => ({ markCloserConnectionDropped: vi.fn(), saveCloserAccessToken: vi.fn() }));
vi.mock('./google', () => ({ refreshCloserAccessToken: vi.fn() }));
vi.mock('./token', () => ({ sealOAuthToken: vi.fn() }));

import { readCloserOwnAgenda } from './read';

const connection = {
  id: 'own-1',
  orgId: 'org-1',
  closerId: 'c1',
  calendarEmail: 'closer@example.com',
  accessTokenEncrypted: 'enc',
  refreshTokenEncrypted: 'enc-r',
  tokenExpiresAt: '2099-01-01T00:00:00.000Z',
  status: 'connected' as const,
};

const MIN = '2026-11-16T03:00:00.000Z';
const MAX = '2026-11-21T03:00:00.000Z';

describe('agenda própria do closer com títulos', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    freeBusy.mockResolvedValue({ 'closer@example.com': { busy: [{ start: '2026-11-16T14:00:00Z', end: '2026-11-16T15:00:00Z' }] } });
  });

  it('lê os títulos pelo events.list e não chama o freeBusy', async () => {
    listEvents.mockResolvedValue([
      { id: 'e1', summary: 'Call com Acme', start: { dateTime: '2026-11-16T14:00:00Z' }, end: { dateTime: '2026-11-16T15:00:00Z' } },
    ]);
    const read = await readCloserOwnAgenda(connection, MIN, MAX);
    expect(read.titles).toBe('ok');
    expect(read.calendar).toEqual({
      known: true,
      busy: [{ start: '2026-11-16T14:00:00.000Z', end: '2026-11-16T15:00:00.000Z', title: 'Call com Acme', eventId: 'e1' }],
    });
    expect(listEvents).toHaveBeenCalledWith('access-token', 'closer@example.com', MIN, MAX);
    expect(freeBusy).not.toHaveBeenCalled();
  });

  it('403 insufficientPermissions cai no freeBusy, sem título, e marca o escopo faltando', async () => {
    listEvents.mockRejectedValue(new FakeCalendarEventsError('insufficient_scope', 403));
    const read = await readCloserOwnAgenda(connection, MIN, MAX);
    expect(read.titles).toBe('insufficient_scope');
    expect(read.calendar).toEqual({ known: true, busy: [{ start: '2026-11-16T14:00:00Z', end: '2026-11-16T15:00:00Z' }] });
    expect(freeBusy).toHaveBeenCalledWith('access-token', MIN, MAX, ['closer@example.com']);
  });

  it('falha de rede no events.list também cai no freeBusy, sem pedir reconexão', async () => {
    listEvents.mockRejectedValue(new FakeCalendarEventsError('failed', null));
    const read = await readCloserOwnAgenda(connection, MIN, MAX);
    expect(read.titles).toBe('failed');
    expect(read.calendar.known).toBe(true);
  });

  it('se o freeBusy também falhar, a agenda continua desconhecida', async () => {
    listEvents.mockRejectedValue(new FakeCalendarEventsError('failed', 503));
    freeBusy.mockRejectedValue(new Error('rede'));
    const read = await readCloserOwnAgenda(connection, MIN, MAX);
    expect(read.calendar).toEqual({ known: false, reason: 'freebusy_failed' });
  });

  it('conexão caída não consulta o Google', async () => {
    const read = await readCloserOwnAgenda({ ...connection, status: 'error' }, MIN, MAX);
    expect(read.calendar).toEqual({ known: false, reason: 'token_revogado' });
    expect(listEvents).not.toHaveBeenCalled();
    expect(freeBusy).not.toHaveBeenCalled();
  });
});
