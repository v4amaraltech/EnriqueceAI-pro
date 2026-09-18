-- Correção do mesmo dia da 20260918121458.
--
-- `leads_opened_events` nasceu só com REVOKE e sem nenhum GRANT, então service_role
-- ficou sem EXECUTE. Produção não quebrou porque as duas RPCs públicas são
-- SECURITY DEFINER e resolvem a chamada interna como owner — mas chamada direta
-- (análise ad-hoc, n8n, teste de integração) devolvia "permission denied".
-- Foi o teste `tests/integration/leads-opened-reopen.test.ts` que pegou.
--
-- anon/authenticated seguem sem acesso: a função não tem guard de organização.

BEGIN;

GRANT EXECUTE ON FUNCTION public.leads_opened_events(uuid, uuid[]) TO service_role;

COMMIT;
