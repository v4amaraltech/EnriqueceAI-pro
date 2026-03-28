'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { from } from '@/lib/supabase/from';

import type { DialerProviderInfo } from '../types/dialer-provider';

export async function getDialerProvider(): Promise<ActionResult<DialerProviderInfo>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;

  // Check API4COM
  const { data: api4com } = (await from(supabase, 'api4com_connections' as never)
    .select('id')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .eq('status', 'connected')
    .maybeSingle()) as { data: { id: string } | null };

  if (api4com) {
    return {
      success: true,
      data: { provider: 'api4com', label: 'API4Com' },
    };
  }

  return {
    success: true,
    data: { provider: null, label: '' },
  };
}
