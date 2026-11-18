'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { fetchEmailHealthData } from '../services/email-health.service';
import type { EmailHealthData } from '../types/email-health.types';
import { analyticsParamsSchema } from '../types/shared';
import { getManagerOrgId } from './shared';

export async function fetchEmailHealth(
  userIds: string[] | undefined,
  cadenceId: string | undefined,
  dateRange: { from: string; to: string },
): Promise<ActionResult<EmailHealthData>> {
  try {
    const params = analyticsParamsSchema.safeParse({ period: '30d', userIds, cadenceId, dateRange });
    if (!params.success) return { success: false, error: 'Parâmetros inválidos' };

    // Manager check first: the service-role client below reads other users'
    // mailboxes (non-secret columns only) and worker state, scoped to this org.
    const { orgId } = await getManagerOrgId();
    const supabase = await createServerSupabaseClient();
    const service = createServiceRoleClient();

    const data = await fetchEmailHealthData(
      supabase,
      service,
      orgId,
      `${dateRange.from}T03:00:00Z`,
      `${dateRange.to}T23:59:59-03:00`,
      userIds && userIds.length > 0 ? userIds : undefined,
      cadenceId || undefined,
    );

    return { success: true, data };
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      'digest' in error &&
      typeof (error as { digest: unknown }).digest === 'string' &&
      (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
    ) {
      throw error;
    }
    return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' };
  }
}
