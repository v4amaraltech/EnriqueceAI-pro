import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockScheduled = vi.fn();
const mockHeld = vi.fn();

vi.mock('./ranking-metrics.service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ranking-metrics.service')>();
  return {
    ...actual,
    fetchScheduledLeadsForRanking: (...args: unknown[]) => mockScheduled(...args),
  };
});

vi.mock('./dashboard-metrics.service', () => ({
  fetchHeldLeadsForKpi: (...args: unknown[]) => mockHeld(...args),
}));

import { fetchMeetingsByDayLeads } from './meetings-by-day-leads.service';

const supabase = {} as never;
const ORG = 'org-1';
const filters = { month: '2026-09', cadenceIds: [] as string[], userIds: [] as string[] };

describe('fetchMeetingsByDayLeads', () => {
  beforeEach(() => {
    mockScheduled.mockReset();
    mockHeld.mockReset();
    mockScheduled.mockResolvedValue({ sdrIds: new Set(), leads: [] });
    mockHeld.mockResolvedValue([]);
  });

  it('repassa os MESMOS filtros da página aos dois universos dos cards', async () => {
    await fetchMeetingsByDayLeads(supabase, ORG, filters, 14);
    expect(mockScheduled).toHaveBeenCalledWith(supabase, ORG, filters);
    expect(mockHeld).toHaveBeenCalledWith(supabase, ORG, filters);
  });

  it('corta as marcadas pelo dia BRT (01:00Z do dia 15 ainda é dia 14)', async () => {
    mockScheduled.mockResolvedValue({
      sdrIds: new Set(['s1']),
      leads: [
        { id: 'a', razao_social: 'Acme', nome_fantasia: null, assigned_to: 's1', meeting_scheduled_at: '2026-09-15T01:00:00Z' },
        { id: 'b', razao_social: 'Beta', nome_fantasia: 'B', assigned_to: 's1', meeting_scheduled_at: '2026-09-15T03:00:00Z' },
        { id: 'c', razao_social: 'Cia', nome_fantasia: null, assigned_to: 's1', meeting_scheduled_at: '2026-09-14T12:00:00Z' },
      ],
    });

    const result = await fetchMeetingsByDayLeads(supabase, ORG, filters, 14);

    expect(result.scheduled.map((l) => l.leadId)).toEqual(['c', 'a']); // ordenado por horário
    expect(result.scheduled[0]).toEqual({
      leadId: 'c',
      razaoSocial: 'Cia',
      nomeFantasia: null,
      sdrId: 's1',
      at: '2026-09-14T12:00:00Z',
    });
  });

  it('corta as realizadas pela âncora da reunião (meeting_starts_at, fallback no carimbo)', async () => {
    mockHeld.mockResolvedValue([
      // evento no dia 14, carimbo no dia 15 → conta no 14
      { id: 'h1', razao_social: 'Held 1', meeting_starts_at: '2026-09-14T14:00:00Z', meeting_held_at: '2026-09-15T10:00:00Z', assigned_to: 's2' },
      // sem evento → carimbo no dia 14
      { id: 'h2', razao_social: 'Held 2', meeting_starts_at: null, meeting_held_at: '2026-09-14T09:00:00Z', assigned_to: null },
      // evento no dia 13 → fora
      { id: 'h3', razao_social: 'Held 3', meeting_starts_at: '2026-09-13T14:00:00Z', meeting_held_at: '2026-09-14T10:00:00Z', assigned_to: 's2' },
    ]);

    const result = await fetchMeetingsByDayLeads(supabase, ORG, filters, 14);

    expect(result.held.map((l) => l.leadId)).toEqual(['h2', 'h1']);
    expect(result.held[0]?.sdrId).toBe('');
    expect(result.held[1]?.at).toBe('2026-09-14T14:00:00Z');
  });

  it('retorna listas vazias num dia sem reuniões', async () => {
    const result = await fetchMeetingsByDayLeads(supabase, ORG, filters, 5);
    expect(result).toEqual({ scheduled: [], held: [] });
  });
});
