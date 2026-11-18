import { describe, expect, it } from 'vitest';

import {
  attributeMailboxes,
  bounceLevel,
  buildHealthTrend,
  computeMailboxStats,
  type EmailHealthRow,
  failureLabel,
  groupFailureReasons,
  inSendingHours,
  isAutoEmailStep,
  lastBusinessDays,
  UNKNOWN_MAILBOX,
  workerHealth,
} from './email-health.logic';

const CAD = 'cad-1';

function row(partial: Partial<EmailHealthRow> & Pick<EmailHealthRow, 'type' | 'lead_id'>): EmailHealthRow {
  return {
    cadence_id: CAD,
    created_at: '2026-11-17T13:00:00.000Z',
    external_id: partial.type === 'sent' ? 'gmail-msg' : null,
    manual_send: null,
    meeting_reminder: null,
    source: null,
    sender_user_id: partial.type === 'sent' ? 'sdr-a' : null,
    performed_by: null,
    error: null,
    reason: null,
    ...partial,
  };
}

describe('bounceLevel', () => {
  it('needs at least 30 leads to colour', () => {
    expect(bounceLevel(0, 0)).toBe('no_data');
    expect(bounceLevel(10, 29)).toBe('small_sample');
  });

  it('is yellow above 3% and red above 5%', () => {
    expect(bounceLevel(3, 100)).toBe('ok');
    expect(bounceLevel(4, 100)).toBe('warning');
    expect(bounceLevel(5, 100)).toBe('warning');
    expect(bounceLevel(6, 100)).toBe('critical');
  });
});

describe('attributeMailboxes', () => {
  it('uses sender_user_id, then performed_by, then the unknown bucket', () => {
    const out = attributeMailboxes([
      row({ type: 'sent', lead_id: 'a', sender_user_id: 'sdr-a' }),
      row({ type: 'sent', lead_id: 'b', sender_user_id: null, performed_by: 'sdr-b' }),
      row({ type: 'sent', lead_id: 'c', sender_user_id: null, performed_by: null }),
    ]);
    expect(out.map((r) => r.mailbox)).toEqual(['sdr-a', 'sdr-b', UNKNOWN_MAILBOX]);
  });

  it('gives bounces and replies the mailbox of the e-mail sent to that lead in that cadence', () => {
    const out = attributeMailboxes([
      row({ type: 'sent', lead_id: 'a', sender_user_id: 'sdr-a', created_at: '2026-11-17T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'a', cadence_id: 'cad-2', sender_user_id: 'sdr-b', created_at: '2026-11-17T10:05:00Z' }),
      row({ type: 'bounced', lead_id: 'a', created_at: '2026-11-17T11:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', cadence_id: 'cad-2', created_at: '2026-11-17T12:00:00Z' }),
    ]);
    expect(out.filter((r) => r.type !== 'sent').map((r) => [r.type, r.mailbox])).toEqual([
      ['bounced', 'sdr-a'],
      ['replied', 'sdr-b'],
    ]);
  });

  it('drops events of leads with no prospecting send (e.g. an Ana IA bounce)', () => {
    const out = attributeMailboxes([
      row({ type: 'sent', lead_id: 'z', source: 'ana_ia_email' }),
      row({ type: 'bounced', lead_id: 'z' }),
      row({ type: 'sent', lead_id: 'm', manual_send: 'true', external_id: null }),
      row({ type: 'replied', lead_id: 'm' }),
    ]);
    expect(out).toEqual([]);
  });

  it('keeps failed sends, attributed to their sender', () => {
    const out = attributeMailboxes([row({ type: 'failed', lead_id: 'a', performed_by: 'sdr-c' })]);
    expect(out.map((r) => r.mailbox)).toEqual(['sdr-c']);
  });
});

describe('computeMailboxStats', () => {
  it('counts e-mails for volume and distinct leads for bounce and reply', () => {
    const rows = attributeMailboxes([
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-17T10:00:00Z' }),
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-17T15:00:00Z' }),
      row({ type: 'sent', lead_id: 'b', created_at: '2026-11-17T10:00:00Z' }),
      row({ type: 'bounced', lead_id: 'b', created_at: '2026-11-17T10:10:00Z' }),
      row({ type: 'bounced', lead_id: 'b', created_at: '2026-11-17T12:10:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-17T16:00:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-17T17:00:00Z' }),
      row({ type: 'failed', lead_id: 'c', performed_by: 'sdr-a' }),
    ]);
    const s = computeMailboxStats(rows).get('sdr-a');
    expect(s).toEqual({
      sent: 3,
      emailedLeads: 2,
      bouncedLeads: 1,
      repliedLeads: 1,
      failed: 1,
      lastSentAt: '2026-11-17T15:00:00Z',
    });
  });

  it('ignores events whose send is outside the given rows', () => {
    const rows = attributeMailboxes([
      row({ type: 'sent', lead_id: 'a', created_at: '2026-10-01T10:00:00Z' }),
      row({ type: 'bounced', lead_id: 'a', created_at: '2026-11-17T10:00:00Z' }),
    ]);
    // the period only covers November: the send is not in it
    const s = computeMailboxStats(rows.filter((r) => r.created_at >= '2026-11-01'));
    expect(s.get('sdr-a')).toBeUndefined();
  });
});

describe('buildHealthTrend', () => {
  it('buckets by BRT day and counts first bounce / reply per lead', () => {
    const rows = attributeMailboxes([
      // 01:00 UTC on the 18th is still the 17th in BRT
      row({ type: 'sent', lead_id: 'a', created_at: '2026-11-18T01:00:00Z' }),
      row({ type: 'sent', lead_id: 'b', created_at: '2026-11-18T13:00:00Z' }),
      row({ type: 'failed', lead_id: 'c', performed_by: 'sdr-a', created_at: '2026-11-18T13:00:00Z' }),
      row({ type: 'bounced', lead_id: 'b', created_at: '2026-11-18T13:05:00Z' }),
      row({ type: 'bounced', lead_id: 'b', created_at: '2026-11-19T13:05:00Z' }),
      row({ type: 'replied', lead_id: 'a', created_at: '2026-11-19T13:00:00Z' }),
    ]);
    const trend = buildHealthTrend(rows, ['2026-11-17', '2026-11-18', '2026-11-19'], (d) => d);
    expect(trend.map((d) => [d.date, d.sent, d.failed, d.bounced, d.replied])).toEqual([
      ['2026-11-17', 1, 0, 0, 0],
      ['2026-11-18', 1, 1, 1, 0],
      ['2026-11-19', 0, 0, 0, 1],
    ]);
  });
});

describe('lastBusinessDays', () => {
  it('skips weekends and national holidays, oldest first', () => {
    // Fri 2026-11-20 (Consciência Negra) is a national holiday; Sat/Sun skipped
    const days = lastBusinessDays(3, new Date('2026-11-23T15:00:00Z'));
    expect(days).toEqual(['2026-11-18', '2026-11-19', '2026-11-23']);
  });
});

describe('failure reasons', () => {
  it('maps known errors to plain labels', () => {
    expect(failureLabel({ error: 'Falha ao renovar token Gmail — reconexão necessária', reason: null })).toBe(
      'Gmail precisa reconectar',
    );
    expect(failureLabel({ error: null, reason: 'no_lead_email' })).toBe('Lead sem e-mail');
    expect(failureLabel({ error: null, reason: null })).toBe('Sem motivo registrado');
  });

  it('groups and sorts by count', () => {
    const rows = attributeMailboxes([
      row({ type: 'failed', lead_id: 'a', performed_by: 'x', reason: 'no_lead_email' }),
      row({ type: 'failed', lead_id: 'b', performed_by: 'x', error: 'Falha ao renovar token Gmail — reconexão necessária' }),
      row({ type: 'failed', lead_id: 'c', performed_by: 'x', error: 'Falha ao renovar token Gmail — reconexão necessária' }),
    ]);
    expect(groupFailureReasons(rows)).toEqual([
      { reason: 'Gmail precisa reconectar', count: 2 },
      { reason: 'Lead sem e-mail', count: 1 },
    ]);
  });
});

describe('inSendingHours', () => {
  it('is Mon–Fri 08:00–17:59 BRT on business days', () => {
    expect(inSendingHours(new Date('2026-11-17T11:00:00Z'))).toBe(true); // Tue 08:00 BRT
    expect(inSendingHours(new Date('2026-11-17T20:59:00Z'))).toBe(true); // Tue 17:59 BRT
    expect(inSendingHours(new Date('2026-11-17T21:00:00Z'))).toBe(false); // Tue 18:00 BRT
    expect(inSendingHours(new Date('2026-11-21T14:00:00Z'))).toBe(false); // Saturday
    expect(inSendingHours(new Date('2026-11-20T14:00:00Z'))).toBe(false); // holiday
  });
});

describe('isAutoEmailStep', () => {
  it('is an e-mail step of an auto_email cadence or with auto_send', () => {
    expect(isAutoEmailStep('auto_email', { channel: 'email', auto_send: null })).toBe(true);
    expect(isAutoEmailStep('standard', { channel: 'email', auto_send: true })).toBe(true);
    expect(isAutoEmailStep('standard', { channel: 'email', auto_send: false })).toBe(false);
    expect(isAutoEmailStep('auto_email', { channel: 'phone', auto_send: true })).toBe(false);
  });
});

describe('workerHealth', () => {
  const worker = { job_name: 'j', label: 'Robô', stale_after_hours: 1 };
  const now = new Date('2026-11-17T15:00:00Z');

  it('is stale past its window, healthy within it', () => {
    expect(workerHealth(worker, '2026-11-17T14:30:00Z', now).stale).toBe(false);
    expect(workerHealth(worker, '2026-11-17T13:30:00Z', now).stale).toBe(true);
    expect(workerHealth(worker, null, now).stale).toBe(true);
  });

  it('is never stale outside its expected hours', () => {
    const h = workerHealth({ ...worker, expectedAt: () => false }, null, now);
    expect(h).toMatchObject({ expectedNow: false, stale: false });
  });
});
