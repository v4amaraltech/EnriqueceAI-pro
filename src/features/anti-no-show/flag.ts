import type { SupabaseClient } from '@supabase/supabase-js';

import { evaluateFlagRow, type FlagRow } from '@/features/contact-engine/services/flag-scope.service';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

/** Flag por org. enabled false e listas vazias = desligada. Não marcar enabled true (ligaria todas as orgs). */
export const ANTI_NO_SHOW_FLAG = 'anti_no_show_cadence';

export type FlagRead = FlagRow | null | 'error';

export function serviceDb(fallback?: SupabaseClient): SupabaseClient {
  try {
    return createServiceRoleClient();
  } catch (err) {
    if (fallback) return fallback;
    throw err;
  }
}

export async function readAntiNoShowFlag(supabase: SupabaseClient): Promise<FlagRead> {
  try {
    const res = (await from(supabase, 'app_flags')
      .select('enabled, allow_org_ids, allow_user_ids')
      .eq('key', ANTI_NO_SHOW_FLAG)
      .limit(1)) as { data: FlagRow[] | null; error: { message: string } | null };
    if (res.error) return 'error';
    return res.data?.[0] ?? null;
  } catch {
    return 'error';
  }
}

export async function isAntiNoShowEnabled(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  const row = await readAntiNoShowFlag(supabase);
  if (row === 'error') return false;
  return evaluateFlagRow(row, { orgId });
}

/**
 * Quem entra no tick novo. Erro de leitura ou flag ausente: ninguém, e a régua antiga segue inteira.
 * enabled true cobre todas as orgs (não usar no piloto). Caso contrário, só allow_org_ids.
 */
export function suppressionPlan(row: FlagRead): { tick: boolean; orgs: 'all' | string[] } {
  if (row === 'error' || !row) return { tick: false, orgs: [] };
  if (row.enabled === true) return { tick: true, orgs: 'all' };
  const orgs = (row.allow_org_ids ?? []).map((id) => id.toLowerCase());
  if (orgs.length === 0) return { tick: false, orgs: [] };
  return { tick: true, orgs };
}
