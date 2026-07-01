import type { NotificationRow } from '../types';

export type SortMode = 'recent' | 'unread-first';
export type FilterMode = 'all' | 'unread';

/**
 * Applies the ⋯ menu's sort + filter to the already-loaded notification list
 * (client-side). The server returns newest-first and `Array.sort` is stable, so
 * date order is preserved within each read/unread group.
 */
export function applyNotificationView(
  notifications: NotificationRow[],
  sort: SortMode,
  filter: FilterMode,
): NotificationRow[] {
  const list = filter === 'unread' ? notifications.filter((n) => !n.read_at) : notifications;
  if (sort === 'unread-first') {
    return [...list].sort((a, b) => (a.read_at ? 1 : 0) - (b.read_at ? 1 : 0));
  }
  return list;
}
