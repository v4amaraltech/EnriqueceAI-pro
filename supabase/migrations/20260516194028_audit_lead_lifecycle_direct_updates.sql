-- Audit lead lifecycle changes that bypass the app's Server Actions.
--
-- Background: on 2026-05-09 and 2026-05-10 someone ran a manual UPDATE in
-- the Supabase Studio SQL Editor to "unstuck" 7 V4 Amaral leads frozen in
-- status='qualified' (due to the short-lived auto-promote model). The SQL
-- set won_at = now() instead of preserving the original qualified_at, so
-- those 7 leads showed up in the Maio dashboard inflating the number by
-- ~13% — and nothing in audit_log captured who/when/why. Pure ghost write.
--
-- This trigger closes the gap: any UPDATE that touches one of the three
-- lifecycle columns (status, won_at, lost_at) and does NOT carry a real
-- auth.uid() lands a row in audit_log with the before/after values, the
-- caller role (anon/authenticated/service_role/null) and a hint of where
-- it came from. App writes via Server Actions already have audit_log
-- entries from the action handlers, so this is purely the "out of band"
-- catch — migrations, cron jobs, service-role API routes, and manual SQL.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_lead_lifecycle_direct_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := COALESCE(auth.role(), 'none');
  v_changes jsonb := '{}'::jsonb;
BEGIN
  -- Only audit when the call has no end-user identity. Server Actions
  -- carry auth.uid() from the SDR's session and already insert their own
  -- audit_log row (action='lead.marked_won', 'lead.marked_lost', etc), so
  -- duplicating those entries would just create noise.
  IF v_uid IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Build the changes diff only for the three lifecycle columns. Other
  -- column changes are ignored — the lifecycle ones are where dashboard
  -- numbers come from, so they're the ones worth auditing closely.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    v_changes := v_changes || jsonb_build_object(
      'status', jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;
  IF NEW.won_at IS DISTINCT FROM OLD.won_at THEN
    v_changes := v_changes || jsonb_build_object(
      'won_at', jsonb_build_object('from', OLD.won_at, 'to', NEW.won_at)
    );
  END IF;
  IF NEW.lost_at IS DISTINCT FROM OLD.lost_at THEN
    v_changes := v_changes || jsonb_build_object(
      'lost_at', jsonb_build_object('from', OLD.lost_at, 'to', NEW.lost_at)
    );
  END IF;

  -- Nothing relevant changed → don't pollute audit_log.
  IF v_changes = '{}'::jsonb THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.audit_log (
    org_id, user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    NEW.org_id,
    NULL, -- caller had no auth.uid()
    'lead.lifecycle_direct_update',
    'lead',
    NEW.id::text,
    jsonb_build_object(
      'changes', v_changes,
      'caller_role', v_role,
      'pg_application_name', current_setting('application_name', true),
      'note', 'UPDATE bypassed Server Actions — likely manual SQL, migration, or service-role cron'
    )
  );

  RETURN NEW;
END;
$$;

-- AFTER UPDATE so the trigger sees the committed-shape NEW values without
-- racing the existing BEFORE UPDATE triggers (set_qualified_at, etc).
DROP TRIGGER IF EXISTS audit_lead_lifecycle_direct_update_trigger ON public.leads;
CREATE TRIGGER audit_lead_lifecycle_direct_update_trigger
  AFTER UPDATE OF status, won_at, lost_at ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_lead_lifecycle_direct_update();

COMMENT ON FUNCTION public.audit_lead_lifecycle_direct_update IS
  'Loga em audit_log mudanças em status/won_at/lost_at de leads quando auth.uid() IS NULL (operações fora do fluxo de Server Action — SQL manual, migration, cron service-role).';

COMMIT;
