import { cache } from 'react';

import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * User directory: user UUID → e-mail / name / avatar, read from `auth.users`.
 *
 * `organization_members` has NO name/e-mail columns (they live in
 * `auth.users`), so `.select('user_email')` on it throws "column
 * organization_members.user_email does not exist" and silently breaks whatever
 * needed it. Use these helpers instead.
 *
 * One RPC (`get_user_profiles`, service_role only) resolves every id at once.
 * This replaced calling `auth.admin.getUserById` once per user (listUsers fails
 * on this project) in ~20 places — the authenticated layout alone did it on
 * every navigation (~5.600 calls/day). The per-id path stays as a fallback if
 * the RPC errors.
 */

export interface UserProfile {
  id: string;
  email: string | null;
  /** full_name > name from user metadata, trimmed; null when both are blank. */
  fullName: string | null;
  avatarUrl: string | null;
  /** fullName || e-mail prefix || first 8 chars of the id — the app-wide display rule. */
  displayName: string;
}

interface ProfileRow {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

function toProfile(row: ProfileRow): UserProfile {
  const fullName = row.full_name?.trim() || null;
  return {
    id: row.id,
    email: row.email,
    fullName,
    avatarUrl: row.avatar_url?.trim() || null,
    displayName: fullName || row.email?.split('@')[0] || row.id.slice(0, 8),
  };
}

/** Fallback: one auth.admin.getUserById per id (the pre-RPC behavior). */
async function fetchProfilesOneByOne(ids: string[]): Promise<ProfileRow[]> {
  const admin = createAdminSupabaseClient();
  const rows = await Promise.all(
    ids.map(async (id): Promise<ProfileRow | null> => {
      try {
        const { data, error } = await admin.auth.admin.getUserById(id);
        if (error || !data?.user) return null;
        const meta = data.user.user_metadata as Record<string, unknown> | undefined;
        const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
        return {
          id: data.user.id,
          email: data.user.email ?? null,
          full_name: pick(meta?.full_name) ?? pick(meta?.name),
          avatar_url: pick(meta?.avatar_url) ?? pick(meta?.picture),
        };
      } catch {
        return null;
      }
    }),
  );
  return rows.filter((r): r is ProfileRow => r !== null);
}

// Keyed by the sorted id list so the layout and the page rendering in the same
// request share one round trip (React `cache` compares arguments by identity).
const loadProfiles = cache(async (sortedIdsKey: string): Promise<Map<string, UserProfile>> => {
  const ids = sortedIdsKey.split(',');
  const map = new Map<string, UserProfile>();

  let rows: ProfileRow[];
  try {
    const admin = createAdminSupabaseClient();
    const { data, error } = await admin.rpc('get_user_profiles', { p_user_ids: ids });
    if (error) throw new Error(error.message);
    // SQL can return NULL name/avatar even though the generated types say string.
    rows = (data as ProfileRow[] | null) ?? [];
  } catch (err) {
    console.error('[user-directory] get_user_profiles failed, falling back to getUserById:', err);
    try {
      rows = await fetchProfilesOneByOne(ids);
    } catch {
      rows = []; // admin client unavailable — callers keep their own fallback
    }
  }

  for (const row of rows) map.set(row.id, toProfile(row));
  return map;
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve user UUIDs → profile. The Map holds ONLY ids that exist in
 * auth.users — callers keep their own fallback for the rest. Never throws.
 */
export async function resolveUserProfiles(
  userIds: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, UserProfile>> {
  const ids = [...new Set(userIds.filter((id): id is string => !!id && UUID_RE.test(id)))].sort();
  if (ids.length === 0) return new Map();
  return loadProfiles(ids.join(','));
}

/**
 * Resolve user UUIDs → e-mail. Returns a Map with ONLY the ids that resolved to
 * a real e-mail. Never throws.
 */
export async function resolveUserEmails(userIds: string[]): Promise<Map<string, string>> {
  const profiles = await resolveUserProfiles(userIds);
  const map = new Map<string, string>();
  for (const [id, p] of profiles) if (p.email) map.set(id, p.email);
  return map;
}
