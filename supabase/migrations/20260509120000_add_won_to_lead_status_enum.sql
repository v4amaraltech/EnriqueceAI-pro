-- Add 'won' value to lead_status enum.
-- 'qualified' = SDR scheduled a meeting (lead is pre-qualified).
-- 'won' = closer confirmed the meeting actually happened (real opportunity / SAL).
--
-- IMPORTANT: ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- as the new value, so this migration only adds the enum value. The backfill
-- and trigger update are in the next migration (20260509120100).

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'won' AFTER 'qualified';
