import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

export interface PendingOrgInvite {
  id: string;
  orgId: string;
  orgName: string;
  role: 'manager' | 'sdr';
  invitedAt: string | null;
  expiresAt: string | null;
}

interface InviteRow {
  id: string;
  org_id: string;
  role: 'manager' | 'sdr';
  invited_at: string | null;
  invited_expires_at: string | null;
  organization: { name: string | null } | Array<{ name: string | null }> | null;
}

/**
 * Lista os convites pendentes (status 'invited', não expirados) que pertencem
 * ao usuário informado. O filtro por user_id é obrigatório: o client é service
 * role (o convidado não enxerga a linha via RLS), então a posse é garantida aqui.
 */
export async function listPendingOrgInvites(
  service: SupabaseClient,
  userId: string,
  now: number = Date.now(),
): Promise<PendingOrgInvite[]> {
  if (!userId) return [];

  const { data, error } = (await from(service, 'organization_members')
    .select('id, org_id, role, invited_at, invited_expires_at, organization:organizations(name)')
    .eq('user_id', userId)
    .eq('status', 'invited')
    .order('invited_at', { ascending: false })) as { data: InviteRow[] | null; error: unknown };

  if (error || !data) return [];

  return data
    .filter((row) => !row.invited_expires_at || new Date(row.invited_expires_at).getTime() >= now)
    .map((row) => {
      const org = Array.isArray(row.organization) ? row.organization[0] : row.organization;
      return {
        id: row.id,
        orgId: row.org_id,
        orgName: org?.name ?? 'Organização',
        role: row.role,
        invitedAt: row.invited_at,
        expiresAt: row.invited_expires_at,
      };
    });
}
