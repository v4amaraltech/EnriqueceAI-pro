'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';

const STALE_DAYS = 3;

interface ActiveCadence {
  id: string;
  name: string;
  org_id: string;
  status: string;
}

/**
 * Check for active cadences that haven't sent any messages in STALE_DAYS.
 * Notifies managers of each org once per cadence (deduplicates by date).
 */
export async function checkStaleCadences(): Promise<ActionResult<{ checked: number; alerted: number }>> {
  const supabase = createServiceRoleClient();

  // Fetch all active cadences
  const { data: cadences, error: cadenceError } = (await (supabase
    .from('cadences') as ReturnType<typeof supabase.from>)
    .select('id, name, org_id, status')
    .eq('status', 'active')) as { data: ActiveCadence[] | null; error: { message: string } | null };

  if (cadenceError) {
    console.error('[stale-cadence] Failed to fetch cadences:', cadenceError.message);
    return { success: false, error: cadenceError.message };
  }

  if (!cadences?.length) {
    return { success: true, data: { checked: 0, alerted: 0 } };
  }

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - STALE_DAYS);
  const cutoffISO = cutoffDate.toISOString();

  // Dedup: check today's date for notification deduplication
  const brt = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const today = brt.toISOString().slice(0, 10);

  let alerted = 0;

  for (const cadence of cadences) {
    try {
      // Check if cadence has any sent interactions in the last STALE_DAYS
      const { count } = (await (supabase
        .from('interactions') as ReturnType<typeof supabase.from>)
        .select('id', { count: 'exact', head: true })
        .eq('cadence_id', cadence.id)
        .eq('type', 'sent')
        .gte('created_at', cutoffISO)) as { count: number | null };

      if ((count ?? 0) > 0) continue;

      // Check if cadence has any active enrollments (otherwise it's just empty, not stale)
      const { count: activeEnrollments } = (await (supabase
        .from('cadence_enrollments') as ReturnType<typeof supabase.from>)
        .select('id', { count: 'exact', head: true })
        .eq('cadence_id', cadence.id)
        .eq('status', 'active')) as { count: number | null };

      if ((activeEnrollments ?? 0) === 0) continue;

      // Dedup: check if we already sent this alert today for this cadence
      const { count: existingAlert } = (await (supabase
        .from('notifications') as ReturnType<typeof supabase.from>)
        .select('id', { count: 'exact', head: true })
        .eq('type', 'integration_error')
        .gte('created_at', `${today}T03:00:00.000Z`)
        .contains('metadata', { alert_type: 'stale_cadence', cadence_id: cadence.id })) as { count: number | null };

      if ((existingAlert ?? 0) > 0) continue;

      // Send notification to managers
      await createNotificationsForOrgMembers({
        orgId: cadence.org_id,
        type: 'integration_error',
        title: `Cadência sem atividade — "${cadence.name}"`,
        body: `A cadência "${cadence.name}" está ativa mas não enviou nenhuma mensagem nos últimos ${STALE_DAYS} dias. Verifique se há enrollments pendentes ou problemas de configuração.`,
        resourceType: 'cadence',
        resourceId: cadence.id,
        metadata: { alert_type: 'stale_cadence', cadence_id: cadence.id },
        roleFilter: 'manager',
      });

      alerted++;
      console.warn(`[stale-cadence] Alert sent: cadence=${cadence.id} name="${cadence.name}" org=${cadence.org_id} active_enrollments=${activeEnrollments}`);
    } catch (err) {
      console.error(`[stale-cadence] Error checking cadence=${cadence.id}:`, err);
    }
  }

  console.warn(`[stale-cadence] Complete: checked=${cadences.length} alerted=${alerted}`);
  return { success: true, data: { checked: cadences.length, alerted } };
}
