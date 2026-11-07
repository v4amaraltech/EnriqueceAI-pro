'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';

import { buildCockpit, type CockpitData, type CockpitInstanceRow, type CockpitQueueItemRow } from '../utils/cockpit-summary';
import { brtDayStartIso } from '../utils/pacing';

const QUEUE_ROWS_LIMIT = 500;

/**
 * Dados do Cockpit: SDR vê o próprio número e a própria fila; gestor vê o time
 * (critérios 12–14). A fila já é escopada pelo RLS; os números (RLS org-wide)
 * são filtrados no servidor.
 */
export async function fetchCockpit(): Promise<ActionResult<CockpitData>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { supabase, userId, orgId, role } = auth.data;
  const isManager = role === 'manager';
  const now = new Date();

  let instanceQuery = from(supabase, 'whatsapp_instances')
    .select('id, user_id, phone, status, auto_send_daily_limit, auto_send_next_at, auto_send_paused_at, auto_send_pause_reason')
    .eq('org_id', orgId)
    .not('user_id', 'is', null);
  if (!isManager) instanceQuery = instanceQuery.eq('user_id', userId);

  let itemQuery = from(supabase, 'whatsapp_send_queue')
    .select(
      'id, sender_user_id, lead_id, status, reason, counts_toward_limit, sent_at, created_at, updated_at, lead:leads(nome_fantasia, razao_social), cadence:cadences(name)',
    )
    .eq('org_id', orgId)
    // pendentes + tudo que aconteceu hoje (BRT)
    .or(`status.in.(pending,sending),updated_at.gte."${brtDayStartIso(now)}"`);
  if (!isManager) itemQuery = itemQuery.eq('sender_user_id', userId);

  const [{ data: instances, error: instErr }, { data: items, error: itemErr }] = await Promise.all([
    instanceQuery as unknown as Promise<{ data: CockpitInstanceRow[] | null; error: { message: string } | null }>,
    itemQuery.order('created_at', { ascending: true }).limit(QUEUE_ROWS_LIMIT) as unknown as Promise<{
      data: CockpitQueueItemRow[] | null;
      error: { message: string } | null;
    }>,
  ]);

  if (instErr || itemErr) {
    console.error('[cockpit] erro ao carregar:', instErr?.message ?? itemErr?.message);
    return { success: false, error: 'Erro ao carregar o Cockpit' };
  }

  const userIds = [
    ...(instances ?? []).map((i) => i.user_id),
    ...(items ?? []).map((i) => i.sender_user_id),
  ];
  const profiles = await resolveUserProfiles(userIds);
  const names = new Map([...profiles].map(([id, p]) => [id, p.displayName]));

  return {
    success: true,
    data: buildCockpit({
      now,
      viewerId: userId,
      isManager,
      instances: instances ?? [],
      items: items ?? [],
      names,
    }),
  };
}
