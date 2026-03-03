export type NotificationType =
  | 'lead_replied'
  | 'lead_opened'
  | 'lead_clicked'
  | 'lead_bounced'
  | 'sync_completed'
  | 'integration_error'
  | 'member_invited'
  | 'member_joined'
  | 'usage_limit_alert';

export type NotificationResourceType = 'lead' | 'cadence' | 'integration' | 'member';

export interface NotificationRow {
  id: string;
  org_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  read_at: string | null;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface NotificationInsert {
  org_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
  metadata?: Record<string, unknown>;
}
