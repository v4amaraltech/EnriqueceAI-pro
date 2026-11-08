import { describe, expect, it, vi } from 'vitest';

import { fetchUpcomingMeetings } from './upcoming-meetings.service';

type Row = Record<string, unknown>;

/** Builder encadeável que resolve com `rows` e guarda as chamadas feitas. */
function fakeSupabase(tables: Record<string, Row[]>) {
  const calls: Record<string, Array<[string, unknown[]]>> = {};
  const client = {
    from: vi.fn((table: string) => {
      calls[table] = [];
      const builder: Record<string, unknown> = {};
      for (const m of ['select', 'eq', 'in', 'is', 'not', 'gte', 'lt', 'order', 'limit']) {
        builder[m] = (...args: unknown[]) => {
          calls[table]!.push([m, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
      return builder;
    }),
  };
  return { client: client as never, calls };
}

const ORG = 'org-1';
const SDRS = [{ user_id: 's1' }, { user_id: 's2' }];

function lead(id: string, startsAt: string, sdr: string | null = 's1'): Row {
  return {
    id,
    razao_social: `Razão ${id}`,
    nome_fantasia: null,
    assigned_to: sdr,
    meeting_scheduled_at: '2026-11-01T12:00:00Z',
    meeting_starts_at: startsAt,
  };
}

describe('fetchUpcomingMeetings', () => {
  it('consulta pela janela BRT, sem arquivado/perdido, ordenado pelo início', async () => {
    const { client, calls } = fakeSupabase({ organization_members: SDRS, leads: [] });

    await fetchUpcomingMeetings(client, ORG, { userIds: [] }, '2026-11-08');

    const q = calls.leads!;
    expect(q).toContainEqual(['eq', ['org_id', ORG]]);
    expect(q).toContainEqual(['is', ['deleted_at', null]]);
    expect(q).toContainEqual(['not', ['status', 'in', '(archived,unqualified)']]);
    expect(q).toContainEqual(['gte', ['meeting_starts_at', '2026-11-08T03:00:00.000Z']]);
    expect(q).toContainEqual(['lt', ['meeting_starts_at', '2026-11-11T03:00:00.000Z']]);
  });

  it('agrupa pelo dia BRT e devolve os 3 dias mesmo vazios', async () => {
    const { client } = fakeSupabase({
      organization_members: SDRS,
      leads: [
        lead('a', '2026-11-09T13:00:00Z'),
        // 22h BRT do dia 09 = 01:00Z do dia 10 → continua no dia 09
        lead('b', '2026-11-10T01:00:00Z'),
        lead('c', '2026-11-10T12:00:00Z', 's2'),
      ],
    });

    const result = await fetchUpcomingMeetings(client, ORG, { userIds: [] }, '2026-11-08');

    expect(result.days.map((d) => [d.date, d.leads.map((l) => l.leadId)])).toEqual([
      ['2026-11-08', []],
      ['2026-11-09', ['a', 'b']],
      ['2026-11-10', ['c']],
    ]);
    expect(result.days[1]!.leads[0]).toEqual({
      leadId: 'a',
      razaoSocial: 'Razão a',
      nomeFantasia: null,
      sdrId: 's1',
      at: '2026-11-01T12:00:00Z',
      meetingAt: '2026-11-09T13:00:00Z',
    });
  });

  it('ignora lead sem SDR ou de SDR inativo e respeita o filtro de vendedor', async () => {
    const { client } = fakeSupabase({
      organization_members: SDRS,
      leads: [
        lead('a', '2026-11-09T13:00:00Z', 's1'),
        lead('b', '2026-11-09T14:00:00Z', 's2'),
        lead('c', '2026-11-09T15:00:00Z', null),
        lead('d', '2026-11-09T16:00:00Z', 'ex-sdr'),
      ],
    });

    const all = await fetchUpcomingMeetings(client, ORG, { userIds: [] }, '2026-11-08');
    expect(all.days[1]!.leads.map((l) => l.leadId)).toEqual(['a', 'b']);

    const onlyS2 = await fetchUpcomingMeetings(client, ORG, { userIds: ['s2'] }, '2026-11-08');
    expect(onlyS2.days[1]!.leads.map((l) => l.leadId)).toEqual(['b']);
  });

  it('janela atravessa a virada de mês', async () => {
    const { client } = fakeSupabase({ organization_members: SDRS, leads: [lead('a', '2026-12-01T13:00:00Z')] });
    const result = await fetchUpcomingMeetings(client, ORG, { userIds: [] }, '2026-11-29');
    expect(result.days.map((d) => d.date)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01']);
    expect(result.days[2]!.leads).toHaveLength(1);
  });
});
