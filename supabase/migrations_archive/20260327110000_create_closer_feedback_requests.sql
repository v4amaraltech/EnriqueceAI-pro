BEGIN;

CREATE TYPE closer_feedback_result AS ENUM ('meeting_done', 'no_show', 'rescheduled');

CREATE TABLE closer_feedback_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES organizations(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE NOT NULL,
  closer_id UUID REFERENCES closers(id) ON DELETE CASCADE NOT NULL,
  token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  result closer_feedback_result,
  rating SMALLINT CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE closer_feedback_requests ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON closer_feedback_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Org members can read feedback requests
CREATE POLICY cfr_org_read ON closer_feedback_requests FOR SELECT
  USING (org_id = public.user_org_id());

-- Insert via service role only (triggered by markLeadAsWon)

COMMIT;
