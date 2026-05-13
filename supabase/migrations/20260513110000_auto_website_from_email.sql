-- Auto-fill `website` from the email domain when the email is corporate.
-- Lemit / Apollo enrichment often returns email but no website; SDRs end
-- up Googling the domain manually. The domain is right there in the email.
--
-- 812 V4 Amaral leads currently have a corporate email but no website.
--
-- Never-overwrite: only fires when website is NULL/empty. Manual edits and
-- previously-set websites stay untouched.
--
-- Personal-email guard: well-known free providers are rejected so we don't
-- end up with website='https://gmail.com'.

BEGIN;

CREATE OR REPLACE FUNCTION public.extract_website_from_email(email_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_domain TEXT;
BEGIN
  IF email_input IS NULL OR position('@' in email_input) = 0 THEN
    RETURN NULL;
  END IF;

  v_domain := lower(split_part(email_input, '@', 2));

  IF v_domain = '' OR position('.' in v_domain) = 0 THEN
    RETURN NULL;
  END IF;

  -- Personal email providers — there's no useful corporate site behind these.
  IF v_domain IN (
    'gmail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br',
    'yahoo.com', 'yahoo.com.br', 'live.com', 'icloud.com', 'me.com', 'msn.com',
    'uol.com.br', 'bol.com.br', 'ig.com.br', 'terra.com.br', 'r7.com',
    'globo.com', 'globomail.com', 'aol.com', 'protonmail.com', 'proton.me'
  ) THEN
    RETURN NULL;
  END IF;

  RETURN 'https://' || v_domain;
END;
$$;

COMMENT ON FUNCTION public.extract_website_from_email(TEXT) IS
  'Returns https://<domain> for corporate emails. NULL for free-provider domains (gmail/hotmail/yahoo/etc).';

REVOKE EXECUTE ON FUNCTION public.extract_website_from_email(TEXT) FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.auto_fill_website()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF (NEW.website IS NULL OR NEW.website = '')
     AND NEW.email IS NOT NULL THEN
    NEW.website := extract_website_from_email(NEW.email);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_fill_website_trigger ON leads;

CREATE TRIGGER auto_fill_website_trigger
  BEFORE INSERT OR UPDATE OF email, website ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_website();

-- Backfill: corporate emails with no website
UPDATE leads
SET website = extract_website_from_email(email)
WHERE deleted_at IS NULL
  AND (website IS NULL OR website = '')
  AND email IS NOT NULL
  AND extract_website_from_email(email) IS NOT NULL;

COMMIT;
