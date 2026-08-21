-- Allow admin-API-driven user creation to opt out of the auto-org/membership/
-- subscription that handle_new_user() normally creates on signup.
--
-- Why: when an operator provisions a manual trial via supabase.auth.admin
-- .createUser, the trigger fires anyway and creates a Starter (14d) org
-- alongside whatever org the operator builds afterwards. The user ends up with
-- two orgs and may log into the wrong one. (Reproduced 2026-05-09 with the
-- Thomas Romano trial: had to delete the auto-created org by hand.)
--
-- Fix: when raw_user_meta_data->>'skip_auto_org' = 'true' (passed via
-- user_metadata in the admin API call), the trigger short-circuits and the
-- caller is responsible for creating the org/membership/subscription itself.
-- All other signups (real product signup flow, magic link, OAuth) keep the
-- existing auto-provisioning behavior.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  org_name TEXT;
  org_slug TEXT;
  new_org_id UUID;
  starter_plan_id UUID;
BEGIN
  -- Manual provisioning escape hatch.
  IF coalesce(NEW.raw_user_meta_data->>'skip_auto_org', '') = 'true' THEN
    RETURN NEW;
  END IF;

  org_name := split_part(NEW.email, '@', 2);
  org_slug := lower(replace(org_name, '.', '-')) || '-' || substr(gen_random_uuid()::text, 1, 8);

  INSERT INTO organizations (name, slug, owner_id, onboarding_step)
  VALUES (org_name, org_slug, NEW.id, 0)
  RETURNING id INTO new_org_id;

  INSERT INTO organization_members (org_id, user_id, role, status, accepted_at)
  VALUES (new_org_id, NEW.id, 'manager', 'active', now());

  SELECT id INTO starter_plan_id FROM plans WHERE slug = 'starter' AND active = true LIMIT 1;

  IF starter_plan_id IS NOT NULL THEN
    INSERT INTO subscriptions (org_id, plan_id, status, current_period_end)
    VALUES (new_org_id, starter_plan_id, 'trialing', now() + INTERVAL '14 days');
  ELSE
    RAISE WARNING '[handle_new_user] Plan "starter" not found. Subscription NOT created for user %. Run seed data.', NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;
