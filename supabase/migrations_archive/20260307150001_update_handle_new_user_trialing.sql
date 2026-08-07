BEGIN;

-- Restore trialing status for new signups (14-day trial on Starter plan)
-- The 'trialing' enum value already exists in subscription_status (never dropped)

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  org_name TEXT;
  org_slug TEXT;
  new_org_id UUID;
  starter_plan_id UUID;
BEGIN
  org_name := split_part(NEW.email, '@', 2);
  org_slug := lower(replace(org_name, '.', '-')) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO organizations (name, slug, owner_id)
  VALUES (org_name, org_slug, NEW.id)
  RETURNING id INTO new_org_id;

  INSERT INTO organization_members (org_id, user_id, role, status, accepted_at)
  VALUES (new_org_id, NEW.id, 'manager', 'active', now());

  -- Create subscription as trialing with 14-day period
  SELECT id INTO starter_plan_id FROM plans WHERE slug = 'starter' AND active = true LIMIT 1;

  IF starter_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (org_id, plan_id, status, current_period_end)
    VALUES (new_org_id, starter_plan_id, 'trialing', now() + INTERVAL '14 days');
  ELSE
    RAISE WARNING '[handle_new_user] Plan "starter" not found. Subscription NOT created for user %. Run seed data.', NEW.id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Update WhatsApp credits cron to include trialing subscriptions
SELECT cron.unschedule('create-monthly-wa-credits');
SELECT cron.schedule('create-monthly-wa-credits', '0 3 1 * *',
  $$ INSERT INTO whatsapp_credits (org_id, plan_credits, used_credits, period)
     SELECT s.org_id, p.max_whatsapp_per_month, 0, to_char(CURRENT_DATE, 'YYYY-MM')
     FROM subscriptions s JOIN plans p ON s.plan_id = p.id
     WHERE s.status IN ('active', 'trialing')
     ON CONFLICT (org_id, period) DO NOTHING $$
);

COMMIT;
