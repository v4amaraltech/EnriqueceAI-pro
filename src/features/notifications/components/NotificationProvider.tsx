'use client';

import { createContext, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

import { createClient } from '@/lib/supabase/client';

import { fetchNotifications } from '../actions/fetch-notifications';
import { markAllNotificationsRead as markAllAction } from '../actions/mark-all-notifications-read';
import { markNotificationRead as markOneAction } from '../actions/mark-notification-read';
import type { NotificationRow } from '../types';
import {
  isNotificationSoundEnabled,
  playNotificationSound,
  SOUND_NOTIFICATION_TYPES,
} from '../utils/notification-sound';

const PAGE_SIZE = 20;

export interface NotificationContextValue {
  notifications: NotificationRow[];
  unreadCount: number;
  loading: boolean;
  hasMore: boolean;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  loadMore: () => Promise<void>;
}

export const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string;
}) {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const hasMore = notifications.length < total;

  // Initial fetch
  useEffect(() => {
    async function load() {
      const result = await fetchNotifications({ limit: PAGE_SIZE, offset: 0 });
      if (result.success) {
        setNotifications(result.data.data);
        setTotal(result.data.total);
        setUnreadCount(result.data.unread_count);
      }
      setLoading(false);
    }
    load();
  }, []);

  // Realtime subscription
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('notifications-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotification = payload.new as NotificationRow;
          setNotifications((prev) => [newNotification, ...prev]);
          setTotal((prev) => prev + 1);
          setUnreadCount((prev) => prev + 1);
          toast(newNotification.title, {
            description: newNotification.body ?? undefined,
          });
          // Audible chime for high-signal notifications, honoring the per-browser
          // toggle. Read fresh from storage so a mid-session toggle takes effect.
          if (
            isNotificationSoundEnabled() &&
            SOUND_NOTIFICATION_TYPES.has(newNotification.type)
          ) {
            playNotificationSound();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const updated = payload.new as NotificationRow;
          setNotifications((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const markAsRead = useCallback(async (id: string) => {
    const result = await markOneAction({ notification_id: id });
    if (result.success) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    }
  }, []);

  const markAllAsRead = useCallback(async () => {
    const result = await markAllAction();
    if (result.success) {
      setNotifications((prev) =>
        prev.map((n) =>
          n.read_at ? n : { ...n, read_at: new Date().toISOString() },
        ),
      );
      setUnreadCount(0);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const result = await fetchNotifications({
      limit: PAGE_SIZE,
      offset: notifications.length,
    });
    if (result.success) {
      setNotifications((prev) => [...prev, ...result.data.data]);
      setTotal(result.data.total);
      setUnreadCount(result.data.unread_count);
    }
  }, [notifications.length]);

  return (
    <NotificationContext.Provider
      value={{
        notifications,
        unreadCount,
        loading,
        hasMore,
        markAsRead,
        markAllAsRead,
        loadMore,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}
