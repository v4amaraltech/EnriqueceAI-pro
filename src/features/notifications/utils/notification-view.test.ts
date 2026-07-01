import { describe, expect, it } from 'vitest';

import type { NotificationRow } from '../types';
import { applyNotificationView } from './notification-view';

function makeRow(id: string, read: boolean): NotificationRow {
  return {
    id,
    org_id: 'org-1',
    user_id: 'user-1',
    type: 'lead_replied',
    title: id,
    body: null,
    read_at: read ? '2026-06-30T12:00:00Z' : null,
    resource_type: null,
    resource_id: null,
    metadata: {},
    created_at: '2026-06-30T12:00:00Z',
    updated_at: '2026-06-30T12:00:00Z',
  };
}

// Server order: newest-first. Mix of read/unread.
const list: NotificationRow[] = [
  makeRow('a', true), // newest, read
  makeRow('b', false), // unread
  makeRow('c', true), // read
  makeRow('d', false), // oldest, unread
];

describe('applyNotificationView', () => {
  it('recent + all keeps the server order untouched', () => {
    expect(applyNotificationView(list, 'recent', 'all').map((n) => n.id)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('filter "unread" drops read notifications, preserving order', () => {
    expect(applyNotificationView(list, 'recent', 'unread').map((n) => n.id)).toEqual(['b', 'd']);
  });

  it('sort "unread-first" moves unread up but keeps date order within each group', () => {
    // unread (b, d) first in original order, then read (a, c) in original order.
    expect(applyNotificationView(list, 'unread-first', 'all').map((n) => n.id)).toEqual([
      'b',
      'd',
      'a',
      'c',
    ]);
  });

  it('does not mutate the input array', () => {
    const before = list.map((n) => n.id);
    applyNotificationView(list, 'unread-first', 'all');
    expect(list.map((n) => n.id)).toEqual(before);
  });

  it('unread-first + filter unread yields only unread in date order', () => {
    expect(applyNotificationView(list, 'unread-first', 'unread').map((n) => n.id)).toEqual([
      'b',
      'd',
    ]);
  });
});
