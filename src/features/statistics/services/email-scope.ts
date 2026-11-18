/**
 * Which e-mail interactions count as prospecting e-mail in the statistics.
 *
 * The `interactions` table mixes every e-mail the platform records as `sent`:
 * cadence e-mails, the "Enviado manualmente" button (no Gmail send),
 * meeting reminders, closer feedback requests and the Ana IA / BDR agent
 * conversation replies. Counting all of them as "enviados" made the e-mail
 * screen unreliable (nov/2026 audit: 2.344 "sent", only 1.439 real cadence
 * e-mails). These rules keep only cadence e-mails that actually left Gmail and
 * the engagement events tied to cadences.
 */

/** Row shape read by the e-mail statistics (metadata fields come as text). */
export interface EmailStatsRow {
  type: string;
  lead_id: string;
  cadence_id: string | null;
  created_at: string;
  external_id: string | null;
  manual_send: string | null;
  meeting_reminder: string | null;
  source: string | null;
}

/** Senders that are not prospecting cadence e-mails. */
const EXCLUDED_SOURCES = new Set(['ana_ia_email', 'closer_feedback', 'bdr_email_agent']);

function isTrue(value: string | null): boolean {
  return value === 'true';
}

/** True when the row belongs to prospecting cadence e-mail. */
export function isProspectingEmailRow(row: EmailStatsRow): boolean {
  if (!row.cadence_id) return false;
  if (row.source && EXCLUDED_SOURCES.has(row.source)) return false;
  if (isTrue(row.meeting_reminder)) return false;
  if (row.type === 'sent') {
    // Only e-mails that went out through Gmail: the manual button records a
    // `sent` without sending anything, so it has no external_id.
    if (isTrue(row.manual_send)) return false;
    if (!row.external_id) return false;
  }
  return true;
}
