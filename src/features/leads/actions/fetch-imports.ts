'use server';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

import type { LeadImportRow } from '../types';

export interface ImportListResult {
  data: (LeadImportRow & { created_by_name: string })[];
  total: number;
}

export async function fetchImports(): Promise<ActionResult<ImportListResult>> {
  const user = await requireAuth();
  const supabase = await createServerSupabaseClient();

  const { data: member } = (await supabase
    .from('organization_members')
    .select('org_id')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .single()) as { data: { org_id: string } | null };

  if (!member) {
    return { success: false, error: 'Organização não encontrada' };
  }

  const { data, count, error } = (await supabase
    .from('lead_imports')
    .select('*', { count: 'exact' })
    .eq('org_id', member.org_id)
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

  if (userIds.length > 0) {
    try {
      const adminClient = createAdminSupabaseClient();
      const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
      if (usersData?.users) {
        const targetIds = new Set(userIds);
        for (const u of usersData.users) {
          if (targetIds.has(u.id)) {
            const meta = u.user_metadata as Record<string, unknown> | undefined;
            const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
            const email = u.email ?? '';
            userMap[u.id] = fullName || email.split('@')[0] || u.id.slice(0, 8);
          }
        }
      }
    } catch {
      for (const id of userIds) {
        userMap[id] = id.slice(0, 8);
      }
    }
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
