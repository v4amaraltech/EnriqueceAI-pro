'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { getCalendarConnection } from '@/features/integrations/services/calendar.service';

import { loadCloserAvailability, type CloserAvailabilityData } from './closer-availability.service';

export async function getCloserAvailability(
  closerId: string,
  timeMin: string,
  timeMax: string,
): Promise<ActionResult<CloserAvailabilityData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, userId, supabase } = auth.data;
  if (!closerId) {
    return { success: false, error: 'Escolha um closer para ver a agenda dele. Sem closer, nenhum horário fica livre.' };
  }

  const sdrConnection = await getCalendarConnection(userId, orgId);
  const loaded = await loadCloserAvailability({
    supabase,
    orgId,
    userId,
    closerId,
    timeMin,
    timeMax,
    sdrConnection,
  });
  if (!loaded.ok) return { success: false, error: loaded.error };
  return { success: true, data: loaded.data };
}
