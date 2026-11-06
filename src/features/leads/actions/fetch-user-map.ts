'use server';

import { z } from 'zod';

import type { ActionResult } from '@/lib/actions/action-result';
import { requireAuth } from '@/lib/auth/require-auth';
import { resolveUserProfiles } from '@/lib/auth/user-directory';

const userIdsSchema = z.array(z.string().uuid()).max(100);

/**
 * Resolves user UUIDs to display names (auth.users, one query).
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

  const profiles = await resolveUserProfiles(parsed.data);
  const result: Record<string, string> = {};
  for (const id of parsed.data) {
    result[id] = profiles.get(id)?.displayName ?? id.slice(0, 8);
  }

  return { success: true, data: result };
}

/**
 * Resolves user UUIDs to avatar URLs.
 */
export async function fetchAvatarMap(
  userIds: string[],
): Promise<ActionResult<Record<string, string>>> {
  const parsed = userIdsSchema.safeParse(userIds);
  if (!parsed.success) return { success: false, error: 'IDs inválidos' };
  if (parsed.data.length === 0) return { success: true, data: {} };

  await requireAuth();
  const result: Record<string, string> = {};
  for (const [id, p] of await resolveUserProfiles(parsed.data)) {
    if (p.avatarUrl) result[id] = p.avatarUrl;
  }

  return { success: true, data: result };
}
