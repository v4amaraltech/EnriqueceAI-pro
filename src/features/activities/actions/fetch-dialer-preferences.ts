'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgId } from '@/lib/auth/get-org-id';

import type { DialerPreferences } from '../schemas/dialer-preferences.schemas';

const DEFAULTS: DialerPreferences = {
  simultaneous_phones: 2,
  daily_limit_per_lead: 3,
};

export async function fetchDialerPreferences(): Promise<ActionResult<DialerPreferences>> {
  let orgId: string;
  let supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createServerSupabaseClient>>;
  try {
    ({ orgId, supabase } = await getAuthOrgId());
  } catch {
    return { success: true, data: DEFAULTS };
  }

  const { data } = (await supabase
    .from('organization_call_settings')
    .select('dialer_simultaneous_phones, dialer_daily_limit_per_lead')
    .eq('org_id', orgId)
    .single()) as {
    data: {
      dialer_simultaneous_phones: number;
      dialer_daily_limit_per_lead: number;
    } | null;
  };

  if (!data) {
    return { success: true, data: DEFAULTS };
  }

  return {
    success: true,
    data: {
      simultaneous_phones: data.dialer_simultaneous_phones,
      daily_limit_per_lead: data.dialer_daily_limit_per_lead,
    },
  };
}
