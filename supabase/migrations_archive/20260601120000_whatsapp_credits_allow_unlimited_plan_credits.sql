-- whatsapp_credits.plan_credits stores the org's monthly WhatsApp quota.
-- Unlimited plans (Internal, Enterprise) use the documented sentinel -1
-- (see src/lib/utils/plan-limits.ts: UNLIMITED = -1), the same value the
-- `plans` table uses for max_whatsapp_per_month.
--
-- Bug: chk_wa_credits_positive required plan_credits >= 0, so the FIRST send
-- of every period for an org on an unlimited plan failed. createAndDeduct()
-- inserts the new period row with plan_credits = -1; the CHECK rejected it
-- (SQLSTATE 23514), the insert retry found no row (it was never created — not
-- a race), and the send was blocked with "Falha ao criar créditos". This also
-- left the isUnlimited() branch in deductFromExisting() as dead code, since no
-- unlimited org could ever have a credit row.
--
-- Repro: V4 Company Amaral switched 500 -> Internal (unlimited); 2026-06 is the
-- first period under the unlimited plan, so every SDR (e.g. Guilherme Marques)
-- was blocked on the first WhatsApp send of the month.
--
-- Fix: allow plan_credits >= -1 (the unlimited sentinel) while keeping
-- used_credits and overage_count strictly non-negative.

BEGIN;

ALTER TABLE whatsapp_credits DROP CONSTRAINT IF EXISTS chk_wa_credits_positive;

ALTER TABLE whatsapp_credits ADD CONSTRAINT chk_wa_credits_positive
  CHECK (plan_credits >= -1 AND used_credits >= 0 AND overage_count >= 0);

COMMIT;
