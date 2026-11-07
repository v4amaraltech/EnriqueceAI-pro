import { describe, expect, it } from 'vitest';

import { buildCloserMonthStats, pctOf } from './closer-stats';

describe('buildCloserMonthStats', () => {
  it('separa realizada, no-show e agendada e soma canceladas', () => {
    const stats = buildCloserMonthStats(
      ['c1', 'c2'],
      [
        { closer_id: 'c1', meeting_held_at: '2026-11-03', meeting_no_show_at: null },
        { closer_id: 'c1', meeting_held_at: null, meeting_no_show_at: '2026-11-04' },
        { closer_id: 'c1', meeting_held_at: null, meeting_no_show_at: null },
        { closer_id: 'outro', meeting_held_at: null, meeting_no_show_at: null },
        { closer_id: null, meeting_held_at: null, meeting_no_show_at: null },
      ],
      new Map([['c1', 1], ['desconhecido', 3]]),
    );
    expect(stats.get('c1')).toEqual({ closerId: 'c1', total: 4, scheduled: 1, noShow: 1, held: 1, cancelled: 1 });
    expect(stats.get('c2')).toEqual({ closerId: 'c2', total: 0, scheduled: 0, noShow: 0, held: 0, cancelled: 0 });
  });

  it('percentual seguro com zero', () => {
    expect(pctOf(1, 4)).toBe(25);
    expect(pctOf(0, 0)).toBe(0);
  });
});
