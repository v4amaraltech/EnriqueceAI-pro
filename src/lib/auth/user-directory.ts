import { createAdminSupabaseClient } from '@/lib/supabase/admin';

/**
 * Resolve user UUIDs → email via `auth.users` (admin client).
 *
 * `organization_members` has NO `user_email` column (email lives in
 * `auth.users`), so `.select('user_email')` on it throws
 * "column organization_members.user_email does not exist" and silently breaks
 * whatever needed the email. Use this helper instead.
 *
 * Returns a Map with ONLY the IDs that resolved to a real email — callers keep
 * their own fallback (e.g. the raw id) for the rest. Never throws: if the admin
 * client is unavailable it returns whatever was resolved so far.
 */
export async function resolveUserEmails(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return map;

  try {
    const admin = createAdminSupabaseClient();
    await Promise.all(
      uniqueIds.map(async (id) => {
        try {
          const { data, error } = await admin.auth.admin.getUserById(id);
          if (error || !data?.user?.email) return;
          map.set(id, data.user.email);
        } catch {
          // skip this id — caller falls back
        }
      }),
    );
  } catch {
    // admin client unavailable — return whatever resolved
  }

  return map;
}
