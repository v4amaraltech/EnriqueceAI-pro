import { describe, expect, it } from 'vitest';

import { createFakeSupabase } from '@tests/mocks/postgrest-table';

import { fetchInteractionCounts, sumCells } from './interaction-counts';

const cell = (
  performed_by: string | null,
  channel: string,
  type: string,
  n: number,
  first_at: string,
) => ({
  row_kind: 'cell',
  performed_by,
  channel,
  type,
  day_brt: first_at.slice(0, 10),
  n,
  distinct_leads: null,
  first_at,
  last_at: first_at,
});

describe('fetchInteractionCounts', () => {
  it('separa linhas por SDR, põe os grupos na ordem da 1ª atividade e pede ordem única', async () => {
    const { client, orders, rpcCalls } = createFakeSupabase({
      'rpc:get_interaction_counts': [
        cell('u1', 'phone', 'sent', 3, '2026-08-05T12:00:00.000Z'),
        cell(null, 'email', 'sent', 7, '2026-08-01T12:00:00.000Z'), // sem autor
        cell('u1', 'email', 'replied', 2, '2026-08-03T12:00:00.000Z'),
        {
          row_kind: 'performer',
          performed_by: 'u1',
          channel: null,
          type: null,
          day_brt: null,
          n: null,
          distinct_leads: 4,
          first_at: '2026-08-03T12:00:00.000Z',
          last_at: '2026-08-05T12:00:00.000Z',
        },
        {
          row_kind: 'performer',
          performed_by: null,
          channel: null,
          type: null,
          day_brt: null,
          n: null,
          distinct_leads: 7,
          first_at: '2026-08-01T12:00:00.000Z',
          last_at: '2026-08-01T12:00:00.000Z',
        },
      ],
    });

    const { cells, performers } = await fetchInteractionCounts(client, {
      periodStart: '2026-08-01T03:00:00.000Z',
      periodEnd: '2026-09-01T02:59:59.999Z',
      excludeChannels: ['system'],
      cadenceId: '11111111-1111-4111-8111-111111111111',
    });

    // ordem da primeira atividade (desempate igual ao das telas antigas)
    expect(cells.map((c) => [c.performed_by, c.channel])).toEqual([
      [null, 'email'],
      ['u1', 'email'],
      ['u1', 'phone'],
    ]);
    expect(sumCells(cells)).toBe(12);
    expect(sumCells(cells, (c) => c.performed_by === 'u1')).toBe(5);
    expect(performers.get('u1')).toEqual({ distinctLeads: 4, lastAt: '2026-08-05T12:00:00.000Z' });
    expect(performers.get(null)?.distinctLeads).toBe(7);

    expect(orders['rpc:get_interaction_counts']?.[0]).toEqual([
      'row_kind',
      'performed_by',
      'channel',
      'type',
      'day_brt',
    ]);
    // sem filtro de SDR → parâmetro omitido; cadência vai.
    expect(rpcCalls[0]?.args).toEqual({
      p_start: '2026-08-01T03:00:00.000Z',
      p_end: '2026-09-01T02:59:59.999Z',
      p_exclude_channels: ['system'],
      p_cadence_id: '11111111-1111-4111-8111-111111111111',
    });
  });
});

describe('atMicros', () => {
  it('diferencia instantes no mesmo milissegundo', async () => {
    const { atMicros } = await import('./interaction-counts');
    expect(atMicros('2026-08-01T12:00:00.123456+00:00')).toBeGreaterThan(
      atMicros('2026-08-01T12:00:00.123001+00:00'),
    );
    expect(atMicros('2026-08-01T12:00:00.1+00:00')).toBe(atMicros('2026-08-01T12:00:00.100000+00:00'));
    expect(atMicros('2026-08-01T12:00:00+00:00')).toBe(Date.parse('2026-08-01T12:00:00Z') * 1000);
  });
});
