/**
 * Shared query-result row types used across statistics services.
 *
 * Each service selects a subset of these fields, but the superset type
 * is safe to use because the `as { data: T[] | null }` cast is applied
 * to every query result. Fields not included in a `.select()` call will
 * simply be `undefined` at runtime — and each service only accesses the
 * fields it selects.
 */

/** Result row from `interactions` table queries. */
export interface InteractionQueryRow {
  id: string;
  type: string;
  channel: string | null;
  lead_id: string;
  performed_by: string | null;
  cadence_id: string | null;
  created_at: string;
}

/** Result row from `cadence_enrollments` table queries. */
export interface EnrollmentQueryRow {
  cadence_id: string;
  lead_id: string;
  org_id: string;
  current_step: number | null;
  status: string;
  enrolled_by: string | null;
  loss_reason_id: string | null;
  created_at: string;
  updated_at: string;
}

/** Result row from `leads` table queries. */
export interface LeadQueryRow {
  id: string;
  status: string;
  created_by: string | null;
  assigned_to: string | null;
  won_by: string | null;
  created_at: string;
  won_at: string | null;
}
