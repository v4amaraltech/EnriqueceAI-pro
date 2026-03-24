'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import type { DialerPreferences } from '../schemas/dialer-preferences.schemas';

const DEFAULTS: DialerPreferences = {
  simultaneous_phones: 2,
  daily_limit_per_lead: 3,
};

export async function fetchDialerPreferences(): Promise<ActionResult<DialerPreferences>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return { success: true, data: DEFAULTS };
  const { orgId, supabase } = auth.data;

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
