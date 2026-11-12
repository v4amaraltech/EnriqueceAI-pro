import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.fn();
const loadOwn = vi.fn();
const readOwn = vi.fn();
const queryFreeBusy = vi.fn();
const listEvents = vi.fn();

class FakeCalendarEventsError extends Error {
  constructor(public readonly kind: string, public readonly status: number | null) {
    super('events.list falhou');
    this.name = 'CalendarEventsError';
  }
}

vi.mock('@/features/closer-calendar/flag', () => ({
  isCloserCalendarConnectEnabled: (...args: unknown[]) => flag(...args),
}));
vi.mock('@/features/closer-calendar/db', () => ({
  loadCloserOwnConnection: (...args: unknown[]) => loadOwn(...args),
}));
vi.mock('@/features/closer-calendar/read', () => ({
  readCloserOwnAgenda: (...args: unknown[]) => readOwn(...args),
}));
vi.mock('@/features/integrations/services/calendar.service', () => ({
  getCalendarConnection: vi.fn(),
  getCalendarConnectionWith: vi.fn(),
  queryFreeBusy: (...args: unknown[]) => queryFreeBusy(...args),
  listCalendarEvents: (...args: unknown[]) => listEvents(...args),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    rpc: async () => ({ data: null, error: { message: 'sem usuário de plataforma neste teste' } }),
  }),
}));

import { createQueryBuilder } from '@tests/mocks/supabase';

import { clearCloserEventsCache, loadCloserAvailability, reserveCloserSlot } from './closer-availability.service';

const sdr = {
  id: 'sdr-conn',
  access_token_encrypted: 'a',
  refresh_token_encrypted: 'r',
  token_expires_at: '2099-01-01T00:00:00.000Z',
  calendar_email: 'sdr@example.com',
};

function supabase() {
  return {
    from(table: string) {
      const builder = createQueryBuilder();
      const rows = table === 'closers'
        ? { data: { id: 'c1', email: 'closer@example.com', deleted_at: null }, error: null }
        : { data: [], error: null };
      if (table === 'closers') builder.maybeSingle = vi.fn(async () => rows);
      builder.then = (resolve: (value: typeof rows) => unknown) => Promise.resolve(rows).then(resolve);
      return builder;
    },
  };
}

describe('disponibilidade com a agenda do closer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCloserEventsCache();
    listEvents.mockRejectedValue(new FakeCalendarEventsError('no_access', 404));
    queryFreeBusy.mockImplementation(async (_connection: unknown, _min: string, _max: string, ids: string[]) => {
      const calendars: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
      for (const id of ids) calendars[id] = { busy: [] };
      return calendars;
    });
  });

  it('flag desligada ignora a conexão própria e lê pelo Google do SDR', async () => {
    flag.mockResolvedValue(false);
    const result = await loadCloserAvailability({
      supabase: supabase() as never,
      orgId: 'org-1',
      userId: 'user-1',
      closerId: 'c1',
      timeMin: '2026-11-16T14:00:00.000Z',
      timeMax: '2026-11-16T18:00:00.000Z',
      sdrConnection: sdr,
    });
    expect(loadOwn).not.toHaveBeenCalled();
    expect(readOwn).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.source).toBe('sdr_token');
  });

  it('flag ligada usa a agenda do closer e, se ela falhar, volta para o Google do SDR', async () => {
    flag.mockResolvedValue(true);
    loadOwn.mockResolvedValue({
      id: 'own-1',
      orgId: 'org-1',
      closerId: 'c1',
      calendarEmail: 'closer@example.com',
      accessTokenEncrypted: 'enc',
      refreshTokenEncrypted: 'enc-r',
      tokenExpiresAt: '2099-01-01T00:00:00.000Z',
      status: 'connected',
    });
    readOwn.mockResolvedValueOnce({
      calendar: { known: true, busy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }] },
      titles: 'ok',
    });

    const known = await loadCloserAvailability({
      supabase: supabase() as never,
      orgId: 'org-1',
      userId: 'user-1',
      closerId: 'c1',
      timeMin: '2026-11-16T14:00:00.000Z',
      timeMax: '2026-11-16T18:00:00.000Z',
      sdrConnection: sdr,
    });
    expect(readOwn).toHaveBeenCalledTimes(1);
    expect(known.ok).toBe(true);
    if (known.ok) {
      expect(known.data.source).toBe('closer_token');
      expect(known.data.calendarBusy).toEqual([{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }]);
    }

    clearCloserEventsCache();
    readOwn.mockResolvedValueOnce({ calendar: { known: false, reason: 'token_revogado' }, titles: 'not_tried' });
    const fallback = await loadCloserAvailability({
      supabase: supabase() as never,
      orgId: 'org-1',
      userId: 'user-1',
      closerId: 'c1',
      timeMin: '2026-11-16T14:00:00.000Z',
      timeMax: '2026-11-16T18:00:00.000Z',
      sdrConnection: sdr,
    });
    expect(fallback.ok).toBe(true);
    if (fallback.ok) expect(fallback.data.source).toBe('sdr_token');
  });

  it('conexão antiga do closer (403 de escopo) cai no freeBusy sem título e pede reconexão', async () => {
    flag.mockResolvedValue(true);
    loadOwn.mockResolvedValue(OWN);
    readOwn.mockResolvedValueOnce({
      calendar: { known: true, busy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }] },
      titles: 'insufficient_scope',
    });
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('closer_token');
      expect(result.data.calendarKnown).toBe(true);
      expect(result.data.calendarBusy[0]?.title).toBeUndefined();
      expect(result.data.needsReconnectForTitles).toBe(true);
    }
  });

  it('conexão própria com títulos não pede reconexão e entrega o título', async () => {
    flag.mockResolvedValue(true);
    loadOwn.mockResolvedValue(OWN);
    readOwn.mockResolvedValueOnce({
      calendar: { known: true, busy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z', title: 'Almoço com cliente' }] },
      titles: 'ok',
    });
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.needsReconnectForTitles).toBe(false);
      expect(result.data.calendarBusy[0]?.title).toBe('Almoço com cliente');
    }
  });

  it('Google do SDR sem acesso aos detalhes cai no freeBusy e não pede para o closer reconectar', async () => {
    flag.mockResolvedValue(false);
    listEvents.mockRejectedValue(new FakeCalendarEventsError('no_access', 404));
    queryFreeBusy.mockResolvedValue({ 'closer@example.com': { busy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }] } });
    const result = await load();
    expect(listEvents).toHaveBeenCalledWith(sdr, 'closer@example.com', '2026-11-16T14:00:00.000Z', '2026-11-16T18:00:00.000Z');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBe('sdr_token');
      expect(result.data.calendarKnown).toBe(true);
      expect(result.data.calendarBusy).toEqual([{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }]);
      expect(result.data.needsReconnectForTitles).toBe(false);
    }
  });

  it('Google do SDR com acesso lê os títulos e ignora recusados', async () => {
    flag.mockResolvedValue(false);
    listEvents.mockResolvedValue([
      { summary: 'Demo Acme', start: { dateTime: '2026-11-16T15:00:00Z' }, end: { dateTime: '2026-11-16T16:00:00Z' } },
      { summary: 'Recusado', start: { dateTime: '2026-11-16T16:00:00Z' }, end: { dateTime: '2026-11-16T17:00:00Z' }, attendees: [{ email: 'closer@example.com', responseStatus: 'declined' }] },
    ]);
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.calendarBusy).toEqual([{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z', title: 'Demo Acme' }]);
    }
  });

  it('events.list e freeBusy falhando: agenda desconhecida como hoje', async () => {
    flag.mockResolvedValue(false);
    listEvents.mockRejectedValue(new FakeCalendarEventsError('failed', 503));
    queryFreeBusy.mockRejectedValue(new Error('rede'));
    const result = await load();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.calendarKnown).toBe(false);
      expect(result.data.reason).toBe('freebusy_failed');
    }
  });

  it('cache de 45s reaproveita a leitura da mesma semana e fresh relê', async () => {
    flag.mockResolvedValue(false);
    listEvents.mockResolvedValue([]);
    await load();
    await load();
    expect(listEvents).toHaveBeenCalledTimes(1);
    await load({ fresh: true });
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});

const OWN = {
  id: 'own-1',
  orgId: 'org-1',
  closerId: 'c1',
  calendarEmail: 'closer@example.com',
  accessTokenEncrypted: 'enc',
  refreshTokenEncrypted: 'enc-r',
  tokenExpiresAt: '2099-01-01T00:00:00.000Z',
  status: 'connected' as const,
};

function load(extra: { fresh?: boolean } = {}) {
  return loadCloserAvailability({
    supabase: supabase() as never,
    orgId: 'org-1',
    userId: 'user-1',
    closerId: 'c1',
    timeMin: '2026-11-16T14:00:00.000Z',
    timeMax: '2026-11-16T18:00:00.000Z',
    sdrConnection: sdr,
    ...extra,
  });
}

/** Supabase falso para a reserva: reuniões do app e travas configuráveis. */
function reserveSupabase(options: { appMeetingAt?: string; holdConflict?: boolean } = {}) {
  const inserts: unknown[] = [];
  const client = {
    inserts,
    from(table: string) {
      const builder = createQueryBuilder();
      let rows: { data: unknown; error: unknown } = { data: [], error: null };
      if (table === 'closers') rows = { data: { id: 'c1', email: 'closer@example.com', deleted_at: null }, error: null };
      if (table === 'leads' && options.appMeetingAt) rows = { data: [{ id: 'lead-x', meeting_starts_at: options.appMeetingAt }], error: null };
      builder.maybeSingle = vi.fn(async () => rows);
      builder.insert = vi.fn((payload: unknown) => {
        inserts.push(payload);
        return builder;
      });
      builder.single = vi.fn(async () => (options.holdConflict
        ? { data: null, error: { code: '23P01', message: 'conflicting key value violates exclusion constraint' } }
        : { data: { id: 'hold-1' }, error: null }));
      builder.then = (resolve: (value: typeof rows) => unknown) => Promise.resolve(rows).then(resolve);
      return builder;
    },
  };
  return client;
}

describe('reserva do horário com allowOverlap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCloserEventsCache();
    flag.mockResolvedValue(false);
    queryFreeBusy.mockResolvedValue({ 'closer@example.com': { busy: [] } });
    listEvents.mockResolvedValue([
      { summary: 'Compromisso do closer', start: { dateTime: '2026-11-16T15:00:00Z' }, end: { dateTime: '2026-11-16T16:00:00Z' } },
    ]);
  });

  function reserve(client: ReturnType<typeof reserveSupabase>, allowOverlap?: boolean) {
    return reserveCloserSlot({
      supabase: client as never,
      orgId: 'org-1',
      userId: 'user-1',
      closerId: 'c1',
      leadId: 'lead-1',
      startTime: '2026-11-16T15:00:00.000Z',
      endTime: '2026-11-16T16:00:00.000Z',
      sdrConnection: sdr,
      ...(allowOverlap === undefined ? {} : { allowOverlap }),
    });
  }

  it('ocupado só no Google: recusa sem a flag', async () => {
    const client = reserveSupabase();
    const result = await reserve(client);
    expect(result).toMatchObject({ ok: false, code: 'CLOSER_BUSY' });
    expect(client.inserts).toHaveLength(0);
  });

  it('ocupado só no Google: permite com allowOverlap e cria a trava interna', async () => {
    const client = reserveSupabase();
    const result = await reserve(client, true);
    expect(result).toEqual({ ok: true, holdId: 'hold-1' });
    expect(client.inserts).toHaveLength(1);
  });

  it('reunião já marcada no Enriquece bloqueia mesmo com allowOverlap', async () => {
    const client = reserveSupabase({ appMeetingAt: '2026-11-16T15:00:00.000Z' });
    const result = await reserve(client, true);
    expect(result).toMatchObject({ ok: false, code: 'CLOSER_BUSY' });
    if (!result.ok) expect(result.error).toContain('Enriquece');
    expect(client.inserts).toHaveLength(0);
  });

  it('trava interna em conflito bloqueia mesmo com allowOverlap', async () => {
    const client = reserveSupabase({ holdConflict: true });
    const result = await reserve(client, true);
    expect(result).toMatchObject({ ok: false, code: 'CLOSER_BUSY' });
  });

  it('agenda desconhecida bloqueia mesmo com allowOverlap', async () => {
    listEvents.mockRejectedValue(new FakeCalendarEventsError('failed', 503));
    queryFreeBusy.mockRejectedValue(new Error('rede'));
    const result = await reserve(reserveSupabase(), true);
    expect(result).toMatchObject({ ok: false, code: 'CLOSER_UNKNOWN' });
  });

  it('a reserva relê a agenda e não usa o cache da grade', async () => {
    await reserve(reserveSupabase(), true);
    await reserve(reserveSupabase(), true);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});
