import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const CALL_COCKPIT_OUTCOMES_FLAG_KEY = 'call_cockpit_outcomes';

/**
 * Flag `call_cockpit_outcomes` em `app_flags` (mesmo mecanismo da `call_cockpit_v1`:
 * escopo GLOBAL, sem `org_id`). Em erro de leitura vale desligada.
 */
export async function isCallCockpitOutcomesEnabled(): Promise<boolean> {
  try {
    const client = createServiceRoleClient();
    const { data } = (await from(client, 'app_flags')
      .select('enabled')
      .eq('key', CALL_COCKPIT_OUTCOMES_FLAG_KEY)
      .limit(1)) as { data: Array<{ enabled: boolean }> | null };
    return data?.[0]?.enabled === true;
  } catch {
    return false;
  }
}
