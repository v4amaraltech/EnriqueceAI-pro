-- ============================================================================
-- Flux Sales Engagement 2.0 — Notifications System
-- ============================================================================
-- Adds real-time notification system for org events
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. ENUM TYPE
-- ============================================================================

CREATE TYPE notification_type AS ENUM (
  'lead_replied',
  'lead_opened',
  'lead_clicked',
  'lead_bounced',
  'sync_completed',
  'integration_error',
  'member_invited',
  'member_joined',
  'usage_limit_alert'
);

-- ============================================================================
-- 2. NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  read_at TIMESTAMPTZ,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_notifications_title_not_empty CHECK (char_length(title) > 0)
);

COMMENT ON TABLE notifications IS 'Notificações em tempo real para usuários da organização';
COMMENT ON COLUMN notifications.type IS 'Tipo do evento que gerou a notificação';
COMMENT ON COLUMN notifications.read_at IS 'Timestamp de leitura. NULL = não lida';
COMMENT ON COLUMN notifications.resource_type IS 'Tipo do recurso relacionado (lead, cadence, integration, member)';
COMMENT ON COLUMN notifications.resource_id IS 'ID do recurso relacionado para navegação';
COMMENT ON COLUMN notifications.metadata IS 'Dados extras do evento (JSON livre)';

-- ============================================================================
-- 3. INDEXES
-- ============================================================================

-- Unread notifications for a user (most common query)
CREATE INDEX idx_notifications_user_unread
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- All notifications for a user (paginated list)
CREATE INDEX idx_notifications_user_created
  ON notifications (user_id, created_at DESC);

-- Org-scoped queries
CREATE INDEX idx_notifications_org_id
  ON notifications (org_id);

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Users can read their own notifications within their org
CREATE POLICY "users_read_own_notifications" ON notifications
  FOR SELECT
  USING (user_id = auth.uid() AND org_id = public.user_org_id());

-- Users can update (mark as read) their own notifications
CREATE POLICY "users_update_own_notifications" ON notifications
  FOR UPDATE
  USING (user_id = auth.uid() AND org_id = public.user_org_id());

-- No INSERT policy: notifications are created via service role only

-- ============================================================================
-- 5. TRIGGER — auto-update updated_at
-- ============================================================================

CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- 6. REALTIME — enable postgres_changes for notifications
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

COMMIT;
