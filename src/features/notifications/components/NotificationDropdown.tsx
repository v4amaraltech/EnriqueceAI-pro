'use client';

import { useRouter } from 'next/navigation';
import { Bell, Loader2 } from 'lucide-react';

import { useNotifications } from '../hooks/useNotifications';

import { NotificationItem } from './NotificationItem';

const RESOURCE_ROUTES: Record<string, string> = {
  lead: '/leads',
  cadence: '/cadences',
  integration: '/settings/integrations',
  member: '/settings/users',
};

export function NotificationDropdown() {
  const router = useRouter();
  const { notifications, unreadCount, loading, hasMore, markAsRead, markAllAsRead, loadMore } =
    useNotifications();

  function handleClick(notification: (typeof notifications)[0]) {
    if (!notification.read_at) {
      markAsRead(notification.id);
    }
    // Resumo de atividades atrasadas: não aponta para um recurso específico
    // (sem resource_id), então leva direto à fila de Atividades já filtrada
    // por "Atrasada".
    if (notification.metadata?.alert_type === 'overdue_summary') {
      router.push('/atividades?status=overdue');
      return;
    }
    if (notification.resource_type && notification.resource_id) {
      const base = RESOURCE_ROUTES[notification.resource_type];
      if (base) {
        router.push(`${base}/${notification.resource_id}`);
      }
    }
  }

  return (
    <div className="w-80">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Notificações</h3>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllAsRead()}
            className="text-muted-foreground hover:text-foreground text-xs transition-colors"
          >
            Marcar todas como lidas
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <Bell className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">Nenhuma notificação</p>
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {notifications.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onClick={() => handleClick(n)}
            />
          ))}
          {hasMore && (
            <button
              type="button"
              onClick={() => loadMore()}
              className="text-muted-foreground hover:text-foreground w-full py-3 text-center text-xs transition-colors"
            >
              Carregar mais
            </button>
          )}
        </div>
      )}
    </div>
  );
}
