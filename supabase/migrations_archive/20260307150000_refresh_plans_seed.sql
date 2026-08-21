BEGIN;

-- Idempotent seed: insert or update the 3 plans to ensure correct values
INSERT INTO plans (name, slug, price_cents, max_leads, max_ai_per_day, max_whatsapp_per_month, included_users, additional_user_price_cents, features, active)
VALUES
  ('Starter', 'starter', 14900, 1000, 50, 500, 4, 4900, '{"enrichment": "basic", "crm": false, "calendar": false}'::jsonb, true),
  ('Pro', 'pro', 34900, 5000, 200, 2500, 4, 8900, '{"enrichment": "lemit", "crm": true, "calendar": true}'::jsonb, true),
  ('Enterprise', 'enterprise', 69900, 10000, -1, 10000, 4, 12900, '{"enrichment": "full", "crm": true, "calendar": true}'::jsonb, true)
ON CONFLICT (slug) DO UPDATE SET
  price_cents = EXCLUDED.price_cents,
  max_leads = EXCLUDED.max_leads,
  max_ai_per_day = EXCLUDED.max_ai_per_day,
  max_whatsapp_per_month = EXCLUDED.max_whatsapp_per_month,
  included_users = EXCLUDED.included_users,
  additional_user_price_cents = EXCLUDED.additional_user_price_cents,
  features = EXCLUDED.features,
  active = EXCLUDED.active,
  updated_at = now();

COMMIT;
