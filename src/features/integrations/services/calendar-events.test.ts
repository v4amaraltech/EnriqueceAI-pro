import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_EVENTS_MAX_PAGES,
  CalendarEventsError,
  listCalendarEventsWithToken,
} from './calendar.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/supabase/server', () => ({ createServerSupabaseClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));

function ok(body: unknown) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

function fail(status: number, body: unknown) {
  return { ok: false, status, json: async () => body, text: async () => JSON.stringify(body) };
}

async function kindOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (err) {
    return err instanceof CalendarEventsError ? err.kind : 'other';
  }
}

describe('listCalendarEventsWithToken (fetch mockado, sem Google real)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('pede eventos expandidos, ordenados, no fuso de São Paulo e só com os campos da grade', async () => {
    mockFetch.mockResolvedValueOnce(ok({ items: [{ id: 'a', summary: 'A' }] }));
    const items = await listCalendarEventsWithToken('tok', 'closer+x@firma.com', '2026-11-16T03:00:00.000Z', '2026-11-21T03:00:00.000Z');
    expect(items).toEqual([{ id: 'a', summary: 'A' }]);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://www.googleapis.com/calendar/v3/calendars/closer%2Bx%40firma.com/events');
    expect(parsed.searchParams.get('singleEvents')).toBe('true');
    expect(parsed.searchParams.get('orderBy')).toBe('startTime');
    expect(parsed.searchParams.get('timeZone')).toBe('America/Sao_Paulo');
    expect(parsed.searchParams.get('timeMin')).toBe('2026-11-16T03:00:00.000Z');
    expect(parsed.searchParams.get('timeMax')).toBe('2026-11-21T03:00:00.000Z');
    const fields = parsed.searchParams.get('fields') ?? '';
    expect(fields).toContain('nextPageToken');
    expect(fields).toContain('summary');
    expect(fields).not.toContain('description');
    expect(fields).not.toContain('location');
    expect(init.signal).toBeDefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('pagina pelo nextPageToken até acabar', async () => {
    mockFetch
      .mockResolvedValueOnce(ok({ items: [{ id: '1' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(ok({ items: [{ id: '2' }] }));
    const items = await listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b');
    expect(items.map((item) => item.id)).toEqual(['1', '2']);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(new URL(mockFetch.mock.calls[1]?.[0] as string).searchParams.get('pageToken')).toBe('p2');
  });

  it('para no teto de páginas e falha, em vez de devolver agenda incompleta', async () => {
    mockFetch.mockImplementation(async () => ok({ items: [], nextPageToken: 'sempre' }));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('failed');
    expect(mockFetch).toHaveBeenCalledTimes(CALENDAR_EVENTS_MAX_PAGES);
  });

  it('classifica 403 de escopo, falta de acesso, 5xx e rede', async () => {
    mockFetch.mockResolvedValueOnce(fail(403, { error: { errors: [{ reason: 'insufficientPermissions' }], status: 'PERMISSION_DENIED' } }));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('insufficient_scope');

    mockFetch.mockResolvedValueOnce(fail(404, { error: { errors: [{ reason: 'notFound' }] } }));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('no_access');

    mockFetch.mockResolvedValueOnce(fail(403, { error: { errors: [{ reason: 'forbidden' }] } }));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('no_access');

    mockFetch.mockResolvedValueOnce(fail(503, { error: { message: 'backend' } }));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('failed');

    mockFetch.mockRejectedValueOnce(new Error('ECONNRESET'));
    expect(await kindOf(listCalendarEventsWithToken('tok', 'c@x.com', 'a', 'b'))).toBe('failed');
  });

  it('a mensagem do erro não carrega token nem corpo da resposta', async () => {
    mockFetch.mockResolvedValueOnce(fail(403, { error: { errors: [{ reason: 'insufficientPermissions' }], message: 'segredo do corpo' } }));
    try {
      await listCalendarEventsWithToken('token-secreto', 'c@x.com', 'a', 'b');
    } catch (err) {
      expect(String((err as Error).message)).not.toContain('token-secreto');
      expect(String((err as Error).message)).not.toContain('segredo do corpo');
    }
  });
});
