-- Story 3.3: Add ranking-related target columns to goals tables
-- goals.activities_target: org-level monthly target for total activities
-- goals_per_user.activities_target: per-SDR monthly target for activities
-- goals_per_user.conversion_target: per-SDR monthly target for conversion rate

ALTER TABLE goals
  ADD COLUMN activities_target INTEGER NOT NULL DEFAULT 0;

ALTER TABLE goals_per_user
  ADD COLUMN activities_target INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN conversion_target NUMERIC(5,2) NOT NULL DEFAULT 0;
