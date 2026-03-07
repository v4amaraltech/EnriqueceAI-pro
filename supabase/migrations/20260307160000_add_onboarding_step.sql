BEGIN;

-- Track onboarding progress: NULL = completed, 0-5 = current step
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT NULL;

-- Update handle_new_user to set onboarding_step = 0 for new orgs
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

  INSERT INTO organizations (name, slug, owner_id, onboarding_step)
  VALUES (org_name, org_slug, NEW.id, 0)
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

COMMIT;
