'use client';

import { useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';
import { Bell, Loader2, MoreHorizontal, Volume2, VolumeX } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/components/ui/dropdown-menu';

import { useNotifications } from '../hooks/useNotifications';
import { useNotificationSound } from '../hooks/useNotificationSound';
import {
  applyNotificationView,
  type FilterMode,
  type SortMode,
} from '../utils/notification-view';

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
  const { enabled: soundEnabled, toggle: toggleSound } = useNotificationSound();

  const [sort, setSort] = useState<SortMode>('recent');
  const [filter, setFilter] = useState<FilterMode>('all');

  const visible = useMemo(
    () => applyNotificationView(notifications, sort, filter),
    [notifications, filter, sort],
  );

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

  const loadMoreButton = hasMore ? (
    <button
      type="button"
      onClick={() => loadMore()}
      className="text-muted-foreground hover:text-foreground w-full py-3 text-center text-xs transition-colors"
    >
      Carregar mais
    </button>
  ) : null;

  return (
    <div className="w-80">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h3 className="text-sm font-semibold">Notificações</h3>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => markAllAsRead()}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              Marcar todas como lidas
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Opções de notificações"
                className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors"
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem
                onSelect={(e) => {
                  // Keep the menu open so the label flips in place.
                  e.preventDefault();
                  toggleSound();
                }}
              >
                {soundEnabled ? (
                  <>
                    <VolumeX className="size-4" />
                    Silenciar
                  </>
                ) : (
                  <>
                    <Volume2 className="size-4" />
                    Ativar som
                  </>
                )}
              </DropdownMenuItem>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Ordenar</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => setSort(v as SortMode)}
              >
                <DropdownMenuRadioItem value="recent">Mais recentes</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unread-first">
                  Não lidas primeiro
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>

              <DropdownMenuSeparator />
              <DropdownMenuLabel>Filtrar</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filter}
                onValueChange={(v) => setFilter(v as FilterMode)}
              >
                <DropdownMenuRadioItem value="all">Todas</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="unread">Só não lidas</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="text-muted-foreground size-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8">
          <Bell className="text-muted-foreground size-8" />
          <p className="text-muted-foreground text-sm">
            {filter === 'unread' ? 'Nenhuma notificação não lida' : 'Nenhuma notificação'}
          </p>
          {loadMoreButton}
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {visible.map((n) => (
            <NotificationItem key={n.id} notification={n} onClick={() => handleClick(n)} />
          ))}
          {loadMoreButton}
        </div>
      )}
    </div>
  );
}
