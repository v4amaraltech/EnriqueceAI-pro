'use server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { verifyUnsubscribeToken } from '@/lib/security/unsubscribe-token';

export interface UnsubscribeResult {
  ok: boolean;
  email?: string;
}

/**
 * M9: process an unsubscribe request from a signed token. Public — runs with the
 * service role (no session). Idempotent: suppressing an already-suppressed email
 * still returns ok. The suppression (per org + e-mail) is the source of truth the
 * cadence engine consults before sending; enrollments of OTHER leads sharing the
 * same e-mail are stopped lazily by that check on the next run.
 */
export async function unsubscribeByToken(token: string): Promise<UnsubscribeResult> {
  const parsed = verifyUnsubscribeToken(token);
  if (!parsed) return { ok: false };

  const supabase = createServiceRoleClient();
  const email = parsed.email.toLowerCase();

  const { data: lead } = (await from(supabase, 'leads')
    .select('id, org_id')
    .eq('id', parsed.leadId)
    .single()) as { data: { id: string; org_id: string } | null };

  if (!lead) return { ok: false };

  // Idempotent insert — unique index on (org_id, lower(email)); 23505 = already
  // suppressed, which is a success from the recipient's point of view.
  const { error: insErr } = await from(supabase, 'email_suppressions').insert({
    org_id: lead.org_id,
    email,
    lead_id: lead.id,
    reason: 'unsubscribe',
  } as Record<string, unknown>);

  if (insErr && (insErr as { code?: string }).code !== '23505') {
    console.error('[unsubscribe] Failed to insert suppression:', insErr);
    return { ok: false };
  }

  // Stop this lead's active enrollments now; other leads sharing the e-mail are
  // caught by the suppression check in execute-cadence on their next tick.
  await from(supabase, 'cadence_enrollments')
    .update({ status: 'unsubscribed', completed_at: new Date().toISOString() } as Record<string, unknown>)
    .eq('lead_id', lead.id)
    .eq('status', 'active');

  return { ok: true, email };
}
