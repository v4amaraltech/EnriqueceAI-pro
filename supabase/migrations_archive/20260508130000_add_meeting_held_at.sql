-- Separate "lead qualified for meeting" (qualified_at) from "meeting actually happened" (won_at + meeting_held_at).
-- Before this change, won_at was being stamped at scheduling time, conflating two different events:
--   1. SDR scheduled a meeting (qualification step)
--   2. Meeting actually took place and lead is a real opportunity (SAL)
-- This migration adds meeting_held_at to mark the second event.
-- The won_at column gets repurposed: from now on it's stamped only when closer
-- confirms result='meeting_done' in /api/feedback, alongside meeting_held_at.
BEGIN;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS meeting_held_at TIMESTAMPTZ;

COMMENT ON COLUMN leads.meeting_held_at IS 'When the closer confirmed the meeting actually happened (result=meeting_done). NULL until confirmation.';
COMMENT ON COLUMN leads.won_at IS 'When the lead became a real opportunity / SAL (closer confirmed meeting_done). Same as meeting_held_at by design.';
COMMENT ON COLUMN leads.qualified_at IS 'When the SDR scheduled the meeting and qualified the lead. Predates won_at/meeting_held_at by hours-to-days.';

CREATE INDEX IF NOT EXISTS idx_leads_meeting_held_at_org ON leads(org_id, meeting_held_at)
  WHERE meeting_held_at IS NOT NULL;

COMMIT;
