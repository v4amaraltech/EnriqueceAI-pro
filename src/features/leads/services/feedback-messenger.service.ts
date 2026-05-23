import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

interface ManagerWithInstance {
  user_id: string;
}

/**
 * Returns the user_id of the first active manager in the org whose Evolution
 * instance is connected. Used to centralize closer-feedback WhatsApp dispatches
 * on the manager's number, so the closer always receives the message from the
 * same sender regardless of which SDR closed the lead. Returns null when no
 * eligible manager exists — caller should fall back to email-only.
 */
export async function getFeedbackMessengerUserId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string | null> {
  const { data: managers } = (await from(supabase, 'organization_members')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('role', 'manager')
    .eq('status', 'active')) as { data: ManagerWithInstance[] | null };

  if (!managers?.length) return null;

  const managerIds = managers.map((m) => m.user_id);
  const { data: instances } = (await from(supabase, 'whatsapp_instances')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'connected')
    .in('user_id', managerIds)
    .limit(1)) as { data: Array<{ user_id: string }> | null };

  return instances?.[0]?.user_id ?? null;
}
