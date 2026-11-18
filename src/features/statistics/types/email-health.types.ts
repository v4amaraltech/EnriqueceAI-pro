/** Bounce colour on the e-mail health panel (story email-engine-health-panel). */
export type BounceLevel = 'ok' | 'warning' | 'critical' | 'small_sample' | 'no_data';

/** Connected / needs reconnect (`status='error'`) / paused (`paused_reason`) / no Gmail row. */
export type MailboxStatus = 'connected' | 'reconnect' | 'paused' | 'unknown';

export interface MailboxHealthRow {
  /** Owner user id, or the "unidentified" bucket key. */
  key: string;
  email: string;
  ownerName: string;
  status: MailboxStatus;
  pausedReason: string | null;
  sentToday: number;
  /** `gmail_connections.daily_cap`; null = sem limite. */
  dailyCap: number | null;
  sent: number;
  emailedLeads: number;
  bouncedLeads: number;
  bounceRate: number;
  bounceLevel: BounceLevel;
  repliedLeads: number;
  failed: number;
  lastSentAt: string | null;
}

export interface EmailHealthDay {
  date: string;
  label: string;
  sent: number;
  failed: number;
  bounced: number;
  replied: number;
}

export interface FailureReasonRow {
  reason: string;
  count: number;
}

export interface WorkerHealth {
  jobName: string;
  label: string;
  lastSuccessAt: string | null;
  /** Worker is expected to be running right now (e.g. the engine only runs in business hours). */
  expectedNow: boolean;
  /** Expected now and no success within its window. */
  stale: boolean;
}

export interface EngineNow {
  workers: WorkerHealth[];
  sentToday: number;
  failedToday: number;
  /** Automatic e-mail steps due more than 30 min ago and still not sent. */
  overdueCount: number;
  oldestOverdueAt: string | null;
  /** Mon–Fri business day, 08:00–17:59 BRT — when the engine sends. */
  inSendingHours: boolean;
}

export interface EmailHealthData {
  engine: EngineNow;
  mailboxes: MailboxHealthRow[];
  trend: EmailHealthDay[];
  failureReasons: FailureReasonRow[];
}
