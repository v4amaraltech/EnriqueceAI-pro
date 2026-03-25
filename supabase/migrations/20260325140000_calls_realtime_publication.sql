BEGIN;

-- Enable Realtime for the calls table so the UI can detect
-- hangups triggered by the API4COM webhook (channel-hangup event).
ALTER PUBLICATION supabase_realtime ADD TABLE calls;

COMMIT;
