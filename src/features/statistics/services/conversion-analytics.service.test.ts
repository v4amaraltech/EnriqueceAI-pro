import { describe, expect, it } from 'vitest';

import {
  type ConversionUniverseRow,
  buildConversionAnalytics,
} from './conversion-analytics.service';

const START = '2026-08-11T03:00:00.000Z';
const END = '2026-09-10T02:59:59.999Z';

function row(
  overrides: Partial<ConversionUniverseRow> & { lead_id: string },
): ConversionUniverseRow {
  return {
    status: 'contacted',
    created_by: null,
    won_at: null,
    has_sent: false,
    has_meeting_scheduled: false,
    has_replied: false,
    enrollments: [],
    ...overrides,
  };
}

const enr = (
  cadence_id: string,
  enrolled_at: string,
  updated_at: string,
  for_velocity: boolean,
) => ({
  cadence_id,
  enrolled_at,
  updated_at,
  for_velocity,
});

const cadences = [
  { id: 'c1', name: 'Outbound' },
  { id: 'c2', name: 'Inbound' },
];

describe('buildConversionAnalytics (resultado do RPC → números da tela)', () => {
  it('funil: total = universo; contactados/qualificados pelos marcadores; SAL pelo won_at no período', () => {
    const data = buildConversionAnalytics(
      [
        row({
          lead_id: 'a',
          has_sent: true,
          has_meeting_scheduled: true,
          status: 'won',
          won_at: '2026-08-20T12:00:00+00:00',
        }),
        row({ lead_id: 'b', has_sent: true }),
        // ganho ANTES do período: está no universo (interagiu), mas não é SAL
        row({ lead_id: 'c', status: 'won', won_at: '2026-07-01T12:00:00+00:00' }),
        row({ lead_id: 'd' }),
      ],
      cadences,
      START,
      END,
    );

    expect(data.funnel.map((s) => [s.label, s.count])).toEqual([
      ['Total Leads', 4],
      ['Contactados', 2],
      ['Qualificados', 1],
      ['SAL', 1],
    ]);
    expect(data.stageConversions[0]).toMatchObject({
      from: 'Total Leads',
      to: 'Contactados',
      rate: 50,
    });
  });

  it('velocidade: só inscrições marcadas para o período, de leads qualificados/ganhos', () => {
    const data = buildConversionAnalytics(
      [
        row({
          lead_id: 'q',
          status: 'qualified',
          enrollments: [
            enr('c1', '2026-08-12T00:00:00+00:00', '2026-08-14T00:00:00+00:00', true), // 2 dias
            enr('c2', '2026-05-01T00:00:00+00:00', '2026-08-30T00:00:00+00:00', false), // fora do período
          ],
        }),
        row({
          lead_id: 'w',
          status: 'won',
          enrollments: [enr('c1', '2026-08-15T00:00:00+00:00', '2026-08-19T00:00:00+00:00', true)], // 4 dias
        }),
        // não qualificado: não entra na velocidade
        row({
          lead_id: 'n',
          enrollments: [enr('c1', '2026-08-12T00:00:00+00:00', '2026-09-01T00:00:00+00:00', true)],
        }),
      ],
      cadences,
      START,
      END,
    );

    expect(data.velocity).toEqual({
      avgDaysToQualification: 3,
      medianDaysToQualification: 3,
      totalQualified: 2,
    });
  });

  it('conversão por cadência: vínculo de qualquer época, respostas e reuniões pelos marcadores', () => {
    const data = buildConversionAnalytics(
      [
        row({
          lead_id: 'a',
          status: 'won',
          has_replied: true,
          has_meeting_scheduled: true,
          // inscrito antes do período — ainda conta na cadência (for_velocity=false)
          enrollments: [enr('c1', '2026-05-01T00:00:00+00:00', '2026-05-02T00:00:00+00:00', false)],
        }),
        row({
          lead_id: 'b',
          status: 'new',
          // duas inscrições na mesma cadência contam o lead uma vez só
          enrollments: [
            enr('c1', '2026-08-12T00:00:00+00:00', '2026-08-13T00:00:00+00:00', true),
            enr('c1', '2026-08-20T00:00:00+00:00', '2026-08-21T00:00:00+00:00', true),
          ],
        }),
        row({ lead_id: 'c', status: 'qualified' }), // sem inscrição
      ],
      cadences,
      START,
      END,
    );

    expect(data.cadenceConversion).toEqual([
      {
        cadenceId: 'c1',
        cadenceName: 'Outbound',
        enrollments: 2,
        contacted: 1,
        qualified: 1,
        won: 1,
        replies: 1,
        meetings: 1,
        conversionRate: 50,
      },
    ]); // c2 sem inscritos some da tabela
  });

  it('por origem: sem created_by = Import; qualificados = qualified/won', () => {
    const data = buildConversionAnalytics(
      [
        row({ lead_id: 'a', created_by: 'u1', status: 'qualified' }),
        row({ lead_id: 'b', created_by: 'u1' }),
        row({ lead_id: 'c', created_by: null, status: 'won' }),
      ],
      cadences,
      START,
      END,
    );

    expect(data.conversionByOrigin).toEqual([
      { origin: 'SDR', qualified: 1, unqualified: 1, total: 2, conversionRate: 50 },
      { origin: 'Import', qualified: 1, unqualified: 0, total: 1, conversionRate: 100 },
    ]);
  });

  it('universo vazio → tudo zerado, sem erro', () => {
    const data = buildConversionAnalytics([], cadences, START, END);
    expect(data.funnel.every((s) => s.count === 0)).toBe(true);
    expect(data.velocity.totalQualified).toBe(0);
    expect(data.cadenceConversion).toEqual([]);
    expect(data.conversionByOrigin).toEqual([]);
  });
});
