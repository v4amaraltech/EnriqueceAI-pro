import { describe, expect, it, vi } from 'vitest';

import { clampEndToToday, countOpenedByPerformer, fetchLeadsOpenedRows } from './leads-opened.service';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

describe('fetchLeadsOpenedRows', () => {
  it('chama a versão por linha com o período e as cadências (ordenadas)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ performer_id: 'u1', opened_at: '2026-09-02T13:00:00Z' }], error: null });
    const r = await fetchLeadsOpenedRows({ rpc } as never, ORG, 'S', '2026-09-30T23:59:59-03:00', ['c2', 'c1']);
    expect(rpc).toHaveBeenCalledWith('count_leads_opened_by_sdr_daily', {
      p_org_id: ORG,
      p_start: 'S',
      p_end: '2026-09-30T23:59:59-03:00',
      p_cadence_ids: ['c1', 'c2'],
    });
    expect(r).toEqual({ data: [{ performer_id: 'u1', opened_at: '2026-09-02T13:00:00Z' }], error: null });
  });

  it('sem cadências → null (todas)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const r = await fetchLeadsOpenedRows({ rpc } as never, ORG, 'S', 'E', []);
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_cadence_ids: null });
    expect(r).toEqual({ data: [], error: null });
  });

  it('devolve o erro sem lançar (cada chamador decide)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await fetchLeadsOpenedRows({ rpc } as never, ORG, 'S', 'E', null)).toEqual({
      data: null,
      error: { message: 'boom' },
    });
  });
});

describe('countOpenedByPerformer', () => {
  it('conta uma abertura por linha, por SDR', () => {
    const counts = countOpenedByPerformer([
      { performer_id: 'u1', opened_at: 'a' },
      { performer_id: 'u2', opened_at: 'b' },
      { performer_id: 'u1', opened_at: 'c' },
    ]);
    expect([...counts]).toEqual([
      ['u1', 2],
      ['u2', 1],
    ]);
  });
});

describe('clampEndToToday', () => {
  const today = { year: 2026, month1: 10, day: 4 };

  it('mês corrente: fim do mês vira hoje 23:59 BRT — mesma janela da página do Dashboard', () => {
    expect(clampEndToToday('2026-10-31T23:59:59-03:00', today)).toBe('2026-10-04T23:59:59-03:00');
  });

  it('a janela da página (já cortada em hoje) fica igual', () => {
    expect(clampEndToToday('2026-10-04T23:59:59-03:00', today)).toBe('2026-10-04T23:59:59-03:00');
  });

  it('mês passado não muda', () => {
    expect(clampEndToToday('2026-09-30T23:59:59-03:00', today)).toBe('2026-09-30T23:59:59-03:00');
  });
});
