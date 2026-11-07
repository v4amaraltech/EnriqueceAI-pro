-- whatsapp_send_queue: usuários logados só leem (RLS); escrita só pelo service role.
-- O default privilege do schema concede tudo a authenticated, e TRUNCATE ignora RLS.
BEGIN;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.whatsapp_send_queue FROM authenticated;
REVOKE ALL ON public.whatsapp_send_queue FROM anon;
GRANT SELECT ON public.whatsapp_send_queue TO authenticated;

COMMIT;
