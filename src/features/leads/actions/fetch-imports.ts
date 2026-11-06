'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';
import { resolveUserProfiles } from '@/lib/auth/user-directory';
import { from } from '@/lib/supabase/from';

import type { LeadImportRow } from '../types';

export interface ImportListResult {
  data: (LeadImportRow & { created_by_name: string })[];
  total: number;
}

export async function fetchImports(): Promise<ActionResult<ImportListResult>> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return auth;
  const { orgId, supabase } = auth.data;

  const { data, count, error } = (await from(supabase, 'lead_imports')
    .select('*', { count: 'exact' })
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })) as {
    data: LeadImportRow[] | null;
    count: number | null;
    error: { message: string } | null;
  };

  if (error) {
    return { success: false, error: 'Erro ao buscar importações' };
  }

  const imports = data ?? [];

  // Resolve created_by UUIDs to display names
  const userIds = [...new Set(imports.map((i) => i.created_by).filter(Boolean))] as string[];
  const userMap: Record<string, string> = {};

  const profiles = await resolveUserProfiles(userIds);
  for (const id of userIds) {
    userMap[id] = profiles.get(id)?.displayName ?? id.slice(0, 8);
  }

  const enriched = imports.map((row) => ({
    ...row,
    created_by_name: row.created_by ? (userMap[row.created_by] ?? 'Desconhecido') : 'Sistema',
  }));

  return {
    success: true,
    data: {
      data: enriched,
      total: count ?? 0,
    },
  };
}
