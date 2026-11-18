/**
 * Pure rules of the e-mail health panel (story email-engine-health-panel).
 * Shared by the statistics screen and the health-check alerts, so the bell and
 * the screen always agree on "bounce alto" and on which mailbox sent what.
 */
import { brtDateKey, isBrBusinessDay } from '@/lib/utils/br-holidays';
import type { CriticalWorker } from '@/lib/workers/critical-workers';

import type { BounceLevel, EmailHealthDay, FailureReasonRow, WorkerHealth } from '../types/email-health.types';
import { type EmailStatsRow, isProspectingEmailRow } from './email-scope';

/** Interaction row read by the health panel (metadata fields come as text). */
export interface EmailHealthRow extends EmailStatsRow {
  sender_user_id: string | null;
  performed_by: string | null;
  error: string | null;
  reason: string | null;
}

/** Row attributed to the mailbox (owner user id) that sent it. */
export interface AttributedRow extends EmailHealthRow {
  mailbox: string;
}

/** Bucket for sends whose mailbox can't be identified. */
export const UNKNOWN_MAILBOX = '__unknown__';

export const BOUNCE_WARN_PCT = 3;
/** Same limit as the BDR IA mailbox guard (checkBdrMailboxHealth). */
export const BOUNCE_CRITICAL_PCT = 5;
export const BOUNCE_MIN_LEADS = 30;
/** The engine runs every 5 min; due less than this is just "next run". */
export const OVERDUE_GRACE_MINUTES = 30;

function pct(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

export function bounceRatePct(bounced: number, emailed: number): number {
  return pct(bounced, emailed);
}

/** Colour rule: >3% yellow, >5% red, only with at least 30 leads. */
export function bounceLevel(bounced: number, emailed: number): BounceLevel {
  if (emailed <= 0) return 'no_data';
  if (emailed < BOUNCE_MIN_LEADS) return 'small_sample';
  const rate = (bounced / emailed) * 100;
  if (rate > BOUNCE_CRITICAL_PCT) return 'critical';
  if (rate > BOUNCE_WARN_PCT) return 'warning';
  return 'ok';
}

function senderOf(row: EmailHealthRow): string | null {
  return row.sender_user_id || row.performed_by || null;
}

/**
 * Keeps prospecting rows (email-scope.ts), sorts them and tags each with its
 * mailbox. Sends use `metadata.sender_user_id` (falling back to
 * `performed_by`); bounces and replies inherit the mailbox of the e-mail sent
 * to the same lead in the same cadence, and are dropped when the lead got no
 * prospecting e-mail in `rows` (their rows don't carry the sender's source, so
 * an Ana IA bounce would leak in otherwise).
 */
export function attributeMailboxes(rows: EmailHealthRow[]): AttributedRow[] {
  const prospecting = rows
    .filter(isProspectingEmailRow)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));

  const byPair = new Map<string, string>();
  const byLead = new Map<string, string>();
  for (const row of prospecting) {
    if (row.type !== 'sent') continue;
    const mailbox = senderOf(row) ?? UNKNOWN_MAILBOX;
    const pair = `${row.lead_id}|${row.cadence_id}`;
    if (!byPair.has(pair)) byPair.set(pair, mailbox);
    if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, mailbox);
  }

  const out: AttributedRow[] = [];
  for (const row of prospecting) {
    if (row.type === 'sent' || row.type === 'failed') {
      const mailbox =
        senderOf(row) ?? byPair.get(`${row.lead_id}|${row.cadence_id}`) ?? UNKNOWN_MAILBOX;
      out.push({ ...row, mailbox });
      continue;
    }
    const mailbox = byPair.get(`${row.lead_id}|${row.cadence_id}`) ?? byLead.get(row.lead_id);
    if (!mailbox) continue;
    out.push({ ...row, mailbox });
  }
  return out;
}

export interface MailboxStats {
  sent: number;
  emailedLeads: number;
  bouncedLeads: number;
  repliedLeads: number;
  failed: number;
  lastSentAt: string | null;
}

function emptyStats(): MailboxStats {
  return { sent: 0, emailedLeads: 0, bouncedLeads: 0, repliedLeads: 0, failed: 0, lastSentAt: null };
}

/**
 * Per-mailbox totals over `rows` (already attributed and limited to the
 * window). Bounces/replies count distinct leads, and only leads that received
 * a send from that mailbox inside the same rows, as on the e-mail stats screen.
 */
export function computeMailboxStats(rows: AttributedRow[]): Map<string, MailboxStats> {
  const emailed = new Map<string, Set<string>>();
  const bounced = new Map<string, Set<string>>();
  const replied = new Map<string, Set<string>>();
  const stats = new Map<string, MailboxStats>();
  const get = (key: string) => {
    let s = stats.get(key);
    if (!s) {
      s = emptyStats();
      stats.set(key, s);
    }
    return s;
  };
  const add = (map: Map<string, Set<string>>, key: string, lead: string) => {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(lead);
  };

  for (const row of rows) {
    if (row.type === 'sent') {
      const s = get(row.mailbox);
      s.sent++;
      if (!s.lastSentAt || row.created_at > s.lastSentAt) s.lastSentAt = row.created_at;
      add(emailed, row.mailbox, row.lead_id);
    } else if (row.type === 'failed') {
      get(row.mailbox).failed++;
    }
  }
  for (const row of rows) {
    if (!emailed.get(row.mailbox)?.has(row.lead_id)) continue;
    if (row.type === 'bounced') add(bounced, row.mailbox, row.lead_id);
    else if (row.type === 'replied') add(replied, row.mailbox, row.lead_id);
  }
  for (const [key, s] of stats) {
    s.emailedLeads = emailed.get(key)?.size ?? 0;
    s.bouncedLeads = bounced.get(key)?.size ?? 0;
    s.repliedLeads = replied.get(key)?.size ?? 0;
  }
  return stats;
}

/** BRT calendar day (YYYY-MM-DD) of an ISO timestamp. */
export function brtDay(iso: string): string {
  return brtDateKey(new Date(iso));
}

/** The last `n` BRT business days up to and including `now`'s day (if it is one), oldest first. */
export function lastBusinessDays(n: number, now: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(now.getTime());
  for (let guard = 0; days.length < n && guard < n * 3 + 14; guard++) {
    const key = brtDateKey(cursor);
    if (isBrBusinessDay(key) && !days.includes(key)) days.push(key);
    cursor.setTime(cursor.getTime() - 86_400_000);
  }
  return days.reverse();
}

/**
 * Daily series for `days`: e-mails sent and failed per day; bounces and
 * replies by the day of each lead's first occurrence (leads with a send in
 * `rows`).
 */
export function buildHealthTrend(
  rows: AttributedRow[],
  days: string[],
  label: (day: string) => string,
): EmailHealthDay[] {
  const daySet = new Set(days);
  const counts = new Map(days.map((d) => [d, { sent: 0, failed: 0, bounced: 0, replied: 0 }]));
  const emailed = new Set(rows.filter((r) => r.type === 'sent').map((r) => r.lead_id));
  const firstBounce = new Map<string, string>();
  const firstReply = new Map<string, string>();

  for (const row of rows) {
    const day = brtDay(row.created_at);
    if (row.type === 'sent' || row.type === 'failed') {
      const c = counts.get(day);
      if (c) c[row.type]++;
      continue;
    }
    if (!emailed.has(row.lead_id)) continue;
    if (row.type === 'bounced' && !firstBounce.has(row.lead_id)) firstBounce.set(row.lead_id, day);
    if (row.type === 'replied' && !firstReply.has(row.lead_id)) firstReply.set(row.lead_id, day);
  }
  for (const day of firstBounce.values()) {
    const c = daySet.has(day) ? counts.get(day) : undefined;
    if (c) c.bounced++;
  }
  for (const day of firstReply.values()) {
    const c = daySet.has(day) ? counts.get(day) : undefined;
    if (c) c.replied++;
  }

  return days.map((date) => {
    const c = counts.get(date) ?? { sent: 0, failed: 0, bounced: 0, replied: 0 };
    return { date, label: label(date), ...c };
  });
}

const FAILURE_LABELS: Array<[RegExp, string]> = [
  [/reconex|invalid_grant|renovar token/i, 'Gmail precisa reconectar'],
  [/no_lead_email|sem e-?mail/i, 'Lead sem e-mail'],
  [/rate|quota|429/i, 'Limite do Gmail atingido'],
  [/fetch|network|timeout|could not be resolved/i, 'Falha de rede ao enviar'],
];

/** Human label of a failed send's reason. */
export function failureLabel(row: Pick<EmailHealthRow, 'error' | 'reason'>): string {
  const raw = (row.error || row.reason || '').trim();
  if (!raw) return 'Sem motivo registrado';
  for (const [pattern, label] of FAILURE_LABELS) if (pattern.test(raw)) return label;
  return raw.length > 80 ? `${raw.slice(0, 77)}...` : raw;
}

export function groupFailureReasons(rows: AttributedRow[]): FailureReasonRow[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.type !== 'failed') continue;
    const label = failureLabel(row);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

/** Mon–Fri BRT business day, 08:00–17:59 BRT (engine cron: `*\/5 11-20 * * 1-5` UTC). */
export function inSendingHours(now: Date): boolean {
  const hour = now.getUTCHours();
  return hour >= 11 && hour <= 20 && isBrBusinessDay(brtDateKey(now));
}

/** True when the step is an e-mail the engine sends by itself. */
export function isAutoEmailStep(cadenceType: string | null, step: { channel: string; auto_send: boolean | null }): boolean {
  if (step.channel !== 'email') return false;
  return cadenceType === 'auto_email' || step.auto_send === true;
}

/** Same stale rule as the health-check-workers cron. */
export function workerHealth(
  worker: Pick<CriticalWorker, 'job_name' | 'label' | 'stale_after_hours' | 'expectedAt'>,
  lastSuccessAt: string | null,
  now: Date,
): WorkerHealth {
  const expectedNow = worker.expectedAt ? worker.expectedAt(now) : true;
  const hours = lastSuccessAt ? (now.getTime() - new Date(lastSuccessAt).getTime()) / 3_600_000 : null;
  const stale = expectedNow && (hours === null || hours > worker.stale_after_hours);
  return { jobName: worker.job_name, label: worker.label, lastSuccessAt, expectedNow, stale };
}
