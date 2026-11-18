import { describe, expect, it } from 'vitest';

import { calculateEmailAnalytics } from './email-analytics.service';
import { type EmailStatsRow, isProspectingEmailRow } from './email-scope';

const CAD = 'cad-1';

function row(partial: Partial<EmailStatsRow> & Pick<EmailStatsRow, 'type' | 'lead_id'>): EmailStatsRow {
  return {
    cadence_id: CAD,
    created_at: '2026-11-03T12:00:00.000Z',
    external_id: partial.type === 'sent' ? 'gmail-msg' : null,
    manual_send: null,
    meeting_reminder: null,
    source: null,
    ...partial,
  };
}

describe('isProspectingEmailRow', () => {
  it('keeps a cadence e-mail that left Gmail', () => {
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a' }))).toBe(true);
  });

  it('drops the "Enviado manualmente" button (no Gmail send)', () => {
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', manual_send: 'true', external_id: null }))).toBe(false);
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', manual_send: 'true' }))).toBe(false);
  });

  it('drops a sent row with no Gmail id', () => {
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', external_id: null }))).toBe(false);
  });

  it('drops meeting reminders, closer feedback and the Ana / BDR agent', () => {
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', meeting_reminder: 'true' }))).toBe(false);
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', source: 'closer_feedback' }))).toBe(false);
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', source: 'ana_ia_email' }))).toBe(false);
    expect(isProspectingEmailRow(row({ type: 'replied', lead_id: 'a', source: 'bdr_email_agent' }))).toBe(false);
  });

  it('drops rows without a cadence', () => {
    expect(isProspectingEmailRow(row({ type: 'sent', lead_id: 'a', cadence_id: null }))).toBe(false);
    expect(isProspectingEmailRow(row({ type: 'replied', lead_id: 'a', cadence_id: null }))).toBe(false);
  });

  it('keeps engagement events of cadence e-mails (they have no Gmail id)', () => {
    expect(isProspectingEmailRow(row({ type: 'replied', lead_id: 'a' }))).toBe(true);
    expect(isProspectingEmailRow(row({ type: 'bounced', lead_id: 'a' }))).toBe(true);
  });
});

describe('calculateEmailAnalytics', () => {
  it('returns empty data when nothing qualifies', () => {
    const data = calculateEmailAnalytics([row({ type: 'sent', lead_id: 'a', manual_send: 'true' })]);
    expect(data.totalSent).toBe(0);
    expect(data.funnel).toEqual([]);
  });

  it('counts e-mails for volume but leads for every rate', () => {
    const rows = [
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-03T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-05T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'b', created_at: '2026-11-03T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'c', created_at: '2026-11-03T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'd', created_at: '2026-11-03T10:00:00Z' }),
      // lead a: reply re-recorded on every thread re-check
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-04T10:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-06T10:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-07T10:00:00Z' }),
      row({ type: 'opened', lead_id: 'a', created_at: '2026-11-03T11:00:00Z' }),
      row({ type: 'opened', lead_id: 'a', created_at: '2026-11-03T12:00:00Z' }),
      row({ type: 'opened', lead_id: 'b', created_at: '2026-11-04T11:00:00Z' }),
      row({ type: 'bounced', lead_id: 'c', created_at: '2026-11-03T10:05:00Z' }),
      row({ type: 'bounced', lead_id: 'c', created_at: '2026-11-04T10:05:00Z' }),
      // noise that must not count
      row({ type: 'sent', lead_id: 'x', cadence_id: null, meeting_reminder: 'true', external_id: null }),
      row({ type: 'sent', lead_id: 'y', manual_send: 'true', external_id: null }),
      row({ type: 'sent', lead_id: 'z', source: 'ana_ia_email' }),
      row({ type: 'replied', lead_id: 'z', source: 'ana_ia_email' }),
      // bounce of an Ana e-mail carries no source: lead never got a cadence e-mail
      row({ type: 'bounced', lead_id: 'z' }),
    ];

    const data = calculateEmailAnalytics(rows);

    expect(data.totalSent).toBe(5);
    expect(data.emailedLeads).toBe(4);
    expect(data.totalReplied).toBe(1);
    expect(data.totalOpened).toBe(2);
    expect(data.totalBounced).toBe(1);
    expect(data.totalDelivered).toBe(3);
    expect(data.replyRate).toBe(25);
    expect(data.openRate).toBe(50);
    expect(data.bounceRate).toBe(25);
    expect(data.funnel.map((s) => s.count)).toEqual([4, 3, 2, 0, 1]);
  });

  it('puts first open / reply / bounce of each lead on its day', () => {
    const rows = [
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-03T10:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-07T10:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-04T10:00:00Z' }),
      row({ type: 'bounced', lead_id: 'a', created_at: '2026-11-05T10:00:00Z' }),
      row({ type: 'bounced', lead_id: 'a', created_at: '2026-11-06T10:00:00Z' }),
    ];

    const data = calculateEmailAnalytics(rows);

    expect(data.dailyTrend.map((d) => [d.date, d.sent, d.replied])).toEqual([
      ['2026-11-03', 1, 0],
      ['2026-11-04', 0, 1],
    ]);
    expect(data.bounceTrend.map((d) => [d.date, d.bounced])).toEqual([['2026-11-05', 1]]);
  });
});
