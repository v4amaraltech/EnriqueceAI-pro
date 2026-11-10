import { beforeEach, describe, expect, it, vi } from 'vitest';

const flag = vi.fn();
const loadOwn = vi.fn();
const readOwn = vi.fn();
const queryFreeBusy = vi.fn();

vi.mock('@/features/closer-calendar/flag', () => ({
  isCloserCalendarConnectEnabled: (...args: unknown[]) => flag(...args),
}));
vi.mock('@/features/closer-calendar/db', () => ({
  loadCloserOwnConnection: (...args: unknown[]) => loadOwn(...args),
}));
vi.mock('@/features/closer-calendar/read', () => ({
  readCloserOwnFreeBusy: (...args: unknown[]) => readOwn(...args),
}));
vi.mock('@/features/integrations/services/calendar.service', () => ({
  getCalendarConnection: vi.fn(),
  getCalendarConnectionWith: vi.fn(),
  queryFreeBusy: (...args: unknown[]) => queryFreeBusy(...args),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({
    rpc: async () => ({ data: null, error: { message: 'sem usuário de plataforma neste teste' } }),
  }),
}));

import { createQueryBuilder } from '@tests/mocks/supabase';

import { loadCloserAvailability } from './closer-availability.service';

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
    readOwn.mockResolvedValueOnce({ known: true, busy: [{ start: '2026-11-16T15:00:00.000Z', end: '2026-11-16T16:00:00.000Z' }] });

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

    readOwn.mockResolvedValueOnce({ known: false, reason: 'token_revogado' });
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
});
