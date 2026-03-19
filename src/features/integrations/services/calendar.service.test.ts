import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkFreeBusy, createCalendarEvent } from './calendar.service';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: () => ({
      update: () => ({ eq: () => ({}) }),
    }),
  })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: vi.fn(() => ({
    from: () => ({
      update: () => ({ eq: () => ({}) }),
    }),
  })),
}));

describe('calendar.service', () => {
  const mockConnection = {
    id: 'cal-1',
    access_token_encrypted: 'test-token',
    refresh_token_encrypted: 'test-refresh',
    token_expires_at: new Date(Date.now() + 3600000).toISOString(),
    calendar_email: 'user@gmail.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GCAL_CLIENT_ID = 'test-client-id';
    process.env.GCAL_CLIENT_SECRET = 'test-client-secret';
  });

  describe('createCalendarEvent', () => {
    it('should create event with meet link', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'event-123',
          htmlLink: 'https://calendar.google.com/event/123',
          hangoutLink: 'https://meet.google.com/abc-def-ghi',
          status: 'confirmed',
          summary: 'Test Meeting',
          start: { dateTime: '2026-02-20T09:00:00-03:00' },
          end: { dateTime: '2026-02-20T09:30:00-03:00' },
        }),
      });

      const result = await createCalendarEvent(mockConnection, {
        title: 'Test Meeting',
        description: 'Test description',
        startTime: '2026-02-20T12:00:00Z',
        endTime: '2026-02-20T12:30:00Z',
        attendeeEmail: 'lead@example.com',
        generateMeetLink: true,
      });

      expect(result.id).toBe('event-123');
      expect(result.meetLink).toBe('https://meet.google.com/abc-def-ghi');
      expect(result.summary).toBe('Test Meeting');
    });

    it('should create event without meet link', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'event-456',
          htmlLink: 'https://calendar.google.com/event/456',
          status: 'confirmed',
          summary: 'Simple Meeting',
          start: { dateTime: '2026-02-20T10:00:00-03:00' },
          end: { dateTime: '2026-02-20T10:30:00-03:00' },
        }),
      });

      const result = await createCalendarEvent(mockConnection, {
        title: 'Simple Meeting',
        startTime: '2026-02-20T13:00:00Z',
        endTime: '2026-02-20T13:30:00Z',
      });

      expect(result.id).toBe('event-456');
      expect(result.meetLink).toBeNull();
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Calendar error',
      });

      await expect(
        createCalendarEvent(mockConnection, {
          title: 'Fail Meeting',
          startTime: '2026-02-20T14:00:00Z',
          endTime: '2026-02-20T14:30:00Z',
        }),
      ).rejects.toThrow('Erro ao criar evento');
    });
  });

  describe('checkFreeBusy', () => {
    it('should return busy slots', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            'user@gmail.com': {
              busy: [
                { start: '2026-02-20T09:00:00Z', end: '2026-02-20T09:30:00Z' },
                { start: '2026-02-20T14:00:00Z', end: '2026-02-20T15:00:00Z' },
              ],
            },
          },
        }),
      });

      const result = await checkFreeBusy(
        mockConnection,
        '2026-02-20T00:00:00Z',
        '2026-02-20T23:59:59Z',
      );

      expect(result).toHaveLength(2);
      expect(result[0]!.start).toBe('2026-02-20T09:00:00Z');
    });

    it('should return empty array when free', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          calendars: {
            'user@gmail.com': { busy: [] },
          },
        }),
      });

      const result = await checkFreeBusy(
        mockConnection,
        '2026-02-21T00:00:00Z',
        '2026-02-21T23:59:59Z',
      );

      expect(result).toHaveLength(0);
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'FreeBusy error',
      });

      await expect(
        checkFreeBusy(mockConnection, '2026-02-20T00:00:00Z', '2026-02-20T23:59:59Z'),
      ).rejects.toThrow('Erro ao verificar disponibilidade');
    });
  });
});
