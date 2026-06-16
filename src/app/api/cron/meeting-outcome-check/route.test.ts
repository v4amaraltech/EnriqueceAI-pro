import { describe, it, expect } from 'vitest';

import { addBusinessDays, classifyStage, nextBusinessDayAt9hBRT } from './route';

interface Row {
  lead_id: string;
  org_id: string;
  closer_id: string | null;
  assigned_to: string | null;
  won_by: string | null;
  meeting_end: string;
  checkpoint_at: string | null;
  escalated: boolean;
  has_pending_activity: boolean;
  has_open_feedback: boolean;
}

function makeRow(overrides: Partial<Row> = {}): Row {
  return {
    lead_id: 'l1',
    org_id: 'o1',
    closer_id: 'c1',
    assigned_to: 's1',
    won_by: null,
    meeting_end: '2026-06-08T16:00:00+00:00',
    checkpoint_at: null,
    escalated: false,
    has_pending_activity: false,
    has_open_feedback: false,
    ...overrides,
  };
}

describe('addBusinessDays', () => {
  it('skips weekends', () => {
    // Friday 2026-06-12 + 2 business days = Tuesday 2026-06-16
    const fri = new Date('2026-06-12T12:00:00Z');
    expect(addBusinessDays(fri, 2).toISOString().slice(0, 10)).toBe('2026-06-16');
  });

  it('counts plain weekdays', () => {
    // Monday 2026-06-15 + 2 business days = Wednesday 2026-06-17
    const mon = new Date('2026-06-15T12:00:00Z');
    expect(addBusinessDays(mon, 2).toISOString().slice(0, 10)).toBe('2026-06-17');
  });
});

describe('nextBusinessDayAt9hBRT', () => {
  it('returns next weekday at 12:00 UTC (09:00 BRT)', () => {
    // Monday 2026-06-15 10:00 BRT → next business day Tuesday 16 at 12:00 UTC
    const iso = nextBusinessDayAt9hBRT(new Date('2026-06-15T13:00:00Z'));
    expect(iso).toBe('2026-06-16T12:00:00.000Z');
  });

  it('jumps over the weekend (Friday → Monday)', () => {
    const iso = nextBusinessDayAt9hBRT(new Date('2026-06-12T13:00:00Z'));
    expect(iso.slice(0, 10)).toBe('2026-06-15');
  });
});

describe('classifyStage — stage 1 (checkpoint)', () => {
  const now = new Date('2026-06-16T11:00:00Z');

  it('fires when the meeting ended more than 24h ago and no checkpoint exists', () => {
    expect(classifyStage(makeRow(), now)).toBe('stage1');
  });

  it('does NOT fire within the 24h grace window', () => {
    const row = makeRow({ meeting_end: '2026-06-15T18:00:00+00:00' }); // <24h before now
    expect(classifyStage(row, now)).toBeNull();
  });

  it('does NOT fire if the SDR already has a pending activity', () => {
    expect(classifyStage(makeRow({ has_pending_activity: true }), now)).toBeNull();
  });

  it('ignores rows with an unparseable meeting_end', () => {
    expect(classifyStage(makeRow({ meeting_end: 'not-a-date' }), now)).toBeNull();
  });
});

describe('classifyStage — stage 2 (escalation)', () => {
  const now = new Date('2026-06-16T11:00:00Z');

  it('fires when 2 business days passed since the checkpoint and not yet escalated', () => {
    // Checkpoint Friday 2026-06-12 → +2 business days = Tuesday 2026-06-16
    const row = makeRow({ checkpoint_at: '2026-06-12T11:00:00+00:00', has_pending_activity: true });
    expect(classifyStage(row, now)).toBe('stage2');
  });

  it('does NOT fire before 2 business days elapsed', () => {
    const row = makeRow({ checkpoint_at: '2026-06-15T11:00:00+00:00', has_pending_activity: true });
    expect(classifyStage(row, now)).toBeNull();
  });

  it('does NOT fire again once already escalated', () => {
    const row = makeRow({ checkpoint_at: '2026-06-12T11:00:00+00:00', escalated: true });
    expect(classifyStage(row, now)).toBeNull();
  });
});
