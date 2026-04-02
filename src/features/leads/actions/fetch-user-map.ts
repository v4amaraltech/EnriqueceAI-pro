'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

const userIdsSchema = z.array(z.string().uuid()).max(100);

/**
 * Resolves user UUIDs to display names (email username before @).
 * Uses admin client to access auth.users emails.
 */
export async function fetchUserMap(
  userIds: string[],
): Promise<ActionResult<Record<string, string>>> {
  const parsed = userIdsSchema.safeParse(userIds);
  if (!parsed.success) return { success: false, error: 'IDs inválidos' };

  if (parsed.data.length === 0) {
    return { success: true, data: {} };
  }

  await requireAuth();

  const result: Record<string, string> = {};

  try {
    const adminClient = createAdminSupabaseClient();
    const targetIds = new Set(userIds);
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        if (targetIds.has(u.id)) {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          const email = u.email ?? '';
          result[u.id] = fullName || email.split('@')[0] || u.id.slice(0, 8);
        }
      }
    }
  } catch {
    for (const id of userIds) {
      result[id] = id.slice(0, 8);
    }
  }

  return { success: true, data: result };
}

/**
 * Resolves user UUIDs to avatar URLs.
 */
export async function fetchAvatarMap(
  userIds: string[],
): Promise<ActionResult<Record<string, string>>> {
  if (userIds.length === 0) return { success: true, data: {} };

  await requireAuth();
  const result: Record<string, string> = {};

  try {
    const adminClient = createAdminSupabaseClient();
    const targetIds = new Set(userIds);
    const { data: usersData } = await adminClient.auth.admin.listUsers({ perPage: 100 });
    if (usersData?.users) {
      for (const u of usersData.users) {
        if (targetIds.has(u.id)) {
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const avatarUrl = (meta?.avatar_url ?? '') as string;
          if (avatarUrl) result[u.id] = avatarUrl;
        }
      }
    }
  } catch {
    // fallback: no avatars
  }

  return { success: true, data: result };
}
