'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

const userIdsSchema = z.array(z.string().uuid()).max(100);

/**
 * Resolves user UUIDs to display names.
 * Uses getUserById individually (listUsers fails on this project).
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
    const uniqueIds = [...new Set(userIds)];

    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const { data, error } = await adminClient.auth.admin.getUserById(id);
          if (error || !data?.user) {
            result[id] = id.slice(0, 8);
            return;
          }
          const u = data.user;
          const meta = u.user_metadata as Record<string, unknown> | undefined;
          const fullName = (meta?.full_name ?? meta?.name ?? '') as string;
          const email = u.email ?? '';
          result[id] = fullName || email.split('@')[0] || id.slice(0, 8);
        } catch {
          result[id] = id.slice(0, 8);
        }
      }),
    );
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
    const uniqueIds = [...new Set(userIds)];

    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const { data, error } = await adminClient.auth.admin.getUserById(id);
          if (error || !data?.user) return;
          const meta = data.user.user_metadata as Record<string, unknown> | undefined;
          const avatarUrl = (meta?.avatar_url ?? '') as string;
          if (avatarUrl) result[id] = avatarUrl;
        } catch {
          // skip
        }
      }),
    );
  } catch {
    // fallback: no avatars
  }

  return { success: true, data: result };
}
