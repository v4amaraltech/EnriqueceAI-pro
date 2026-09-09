-- Correção de segurança aplicada logo após 20260909184311.
--
-- Ao recriar `fetch_inactive_enrollment_candidates` (DROP + CREATE, porque a
-- assinatura mudou), o default privilege do schema public reconcedeu EXECUTE a
-- `authenticated` — permissão que a versão anterior NÃO tinha, pois havia sido
-- revogada em 20260516160057. O REVOKE daquela migration não sobrevive a um
-- DROP da função.
--
-- Impacto que isso teria: a função é SECURITY DEFINER e varre
-- cadence_enrollments/leads/interactions de TODAS as organizações, sem filtro
-- de tenant. Com EXECUTE para `authenticated`, qualquer usuário logado de
-- qualquer org poderia enumerar ids de leads e enrollments da base inteira.
--
-- Janela real de exposição em produção: ~2 minutos (18:43 → 18:45 UTC de
-- 09/09/2026), entre a aplicação da migration e esta correção. Nenhuma rota da
-- aplicação chama esse RPC com o cliente `authenticated` — só o cron, com
-- service role.
--
-- A migration 20260909184311 já foi corrigida na origem para incluir
-- `authenticated` no REVOKE; esta fica no histórico para que um banco que
-- aplicou a versão anterior também seja corrigido.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.fetch_inactive_enrollment_candidates(boolean) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.fetch_inactive_enrollment_candidates(boolean) TO service_role;

COMMIT;
