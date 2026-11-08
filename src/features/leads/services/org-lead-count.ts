import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

/**
 * Conta os leads ativos da org ignorando RLS (pista 28).
 *
 * Com `lead_visibility_mode` own/team, a contagem pelo cliente da sessão só vê os
 * leads visíveis ao SDR e subestima o uso real do plano (max_leads). O `orgId` deve
 * vir da sessão autenticada, nunca do input do usuário.
 */
export async function countOrgLeads(orgId: string): Promise<number> {
  const service = createServiceRoleClient();
  const { count } = (await from(service, 'leads')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .is('deleted_at', null)) as { count: number | null };
  return count ?? 0;
}
