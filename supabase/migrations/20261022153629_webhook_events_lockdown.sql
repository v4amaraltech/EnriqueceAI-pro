-- Fecha a leitura pública da webhook_events (22/10/2026).
--
-- A policy webhook_events_org_read (SELECT, roles public) aceitava linhas sem
-- organização (`org_id IS NULL`), e o acesso padrão de anon/authenticated
-- permitia lê-las. Todo acesso legítimo à tabela é feito pela service role
-- (rotas de webhook, workers e lib/webhooks), que ignora RLS e mantém os seus
-- GRANTs.

BEGIN;

REVOKE ALL ON TABLE public.webhook_events FROM anon, authenticated;

-- Só para authenticated e só a própria organização. Sem GRANT de SELECT ela não
-- libera nada hoje; fica correta caso alguém reconceda a leitura por org.
DROP POLICY IF EXISTS webhook_events_org_read ON public.webhook_events;
CREATE POLICY webhook_events_org_read ON public.webhook_events
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.user_org_id()));

COMMIT;
