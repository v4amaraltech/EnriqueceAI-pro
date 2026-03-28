'use client';

import {
  AlertTriangle,
  ArrowRightLeft,
  Bell,
  ClipboardCheck,
  Mail,
  MailOpen,
  MousePointerClick,
  UserPlus,
  UserCheck,
  Zap,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatRelativeTime } from '@/lib/utils/format';

import type { NotificationRow, NotificationType } from '../types';

const ICON_MAP: Record<NotificationType, React.ElementType> = {
  lead_replied: Mail,
  lead_opened: MailOpen,
  lead_clicked: MousePointerClick,
  lead_bounced: AlertTriangle,
  sync_completed: ArrowRightLeft,
  integration_error: Zap,
  member_invited: UserPlus,
  member_joined: UserCheck,
  usage_limit_alert: Bell,
  closer_feedback: ClipboardCheck,
};

export function NotificationItem({
  notification,
  onClick,
}: {
  notification: NotificationRow;
  onClick: () => void;
}) {
  const isUnread = !notification.read_at;
  const Icon = ICON_MAP[notification.type] ?? Bell;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent',
        isUnread && 'bg-accent/50',
      )}
    >
      <div className="mt-0.5 shrink-0">
        <Icon className="text-muted-foreground size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-sm', isUnread && 'font-medium')}>
            {notification.title}
          </span>
          {isUnread && (
            <span className="bg-primary size-2 shrink-0 rounded-full" />
          )}
        </div>
        {notification.body && (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {notification.body}
          </p>
        )}
        <span className="text-muted-foreground mt-1 text-xs">
          {formatRelativeTime(notification.created_at)}
        </span>
      </div>
    </button>
  );
}
