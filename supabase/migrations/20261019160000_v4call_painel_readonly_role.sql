-- =============================================================================
-- v4call_painel — usuário SOMENTE LEITURA para o painel "Ana (BDR IA)" do V4 Call
-- =============================================================================
-- Escopo: SELECT em 8 tabelas, sempre limitado à org V4 Amaral via RLS.
-- Nada de escrita, nada de outras orgs, nada em auth/storage/funções.
--
-- A SENHA NÃO FICA NO REPO. Depois de aplicar esta migration, definir fora dela:
--   ALTER ROLE v4call_painel WITH PASSWORD '<senha forte>';
-- Conexão esperada: Session pooler (IPv4), usuário v4call_painel.<project_ref>.
--
-- Conhecido (fora do escopo desta migration): funções em public com EXECUTE
-- para PUBLIC continuam chamáveis por qualquer role de login, inclusive esta.
-- =============================================================================
BEGIN;

-- 1. Role de login ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'v4call_painel') THEN
    CREATE ROLE v4call_painel
      LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
      CONNECTION LIMIT 5;
  END IF;
END $$;

ALTER ROLE v4call_painel SET statement_timeout = '15s';
ALTER ROLE v4call_painel SET default_transaction_read_only = on;
ALTER ROLE v4call_painel SET search_path = public;

-- 2. Permissões mínimas -------------------------------------------------------
GRANT USAGE ON SCHEMA public TO v4call_painel;

GRANT SELECT ON
  public.cadences,
  public.cadence_steps,
  public.cadence_enrollments,
  public.cadence_step_executions,
  public.interactions,
  public.email_conversations,
  public.leads
TO v4call_painel;

-- gmail_connections: só as colunas que o painel lê (tokens ficam de fora).
GRANT SELECT (
  email_address, status, daily_cap, paused_reason,
  token_expires_at, updated_at, bdr_ai, org_id
) ON public.gmail_connections TO v4call_painel;

-- 3. RLS: uma policy de SELECT por tabela, só para esta role, só para a org ---
DROP POLICY IF EXISTS v4call_painel_select ON public.cadences;
CREATE POLICY v4call_painel_select ON public.cadences
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.cadence_steps;
CREATE POLICY v4call_painel_select ON public.cadence_steps
  FOR SELECT TO v4call_painel
  USING (EXISTS (
    SELECT 1 FROM public.cadences c
    WHERE c.id = cadence_steps.cadence_id
      AND c.org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  ));

DROP POLICY IF EXISTS v4call_painel_select ON public.cadence_enrollments;
CREATE POLICY v4call_painel_select ON public.cadence_enrollments
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.cadence_step_executions;
CREATE POLICY v4call_painel_select ON public.cadence_step_executions
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.interactions;
CREATE POLICY v4call_painel_select ON public.interactions
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.gmail_connections;
CREATE POLICY v4call_painel_select ON public.gmail_connections
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.email_conversations;
CREATE POLICY v4call_painel_select ON public.email_conversations
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

DROP POLICY IF EXISTS v4call_painel_select ON public.leads;
CREATE POLICY v4call_painel_select ON public.leads
  FOR SELECT TO v4call_painel
  USING (org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b');

-- 4. EXECUTE nas funções usadas pelas policies já existentes -------------------
-- As policies "org_read" dessas tabelas valem para `public` e chamam
-- user_org_id() / is_manager() / lead_visibility_mode(). O Postgres combina
-- todas as policies com OR, então sem EXECUTE nelas TODO SELECT da role falha
-- com "permission denied for function user_org_id". Numa sessão sem JWT elas
-- devolvem NULL / false / NULL, ou seja, não liberam linha nenhuma: só a
-- policy v4call_painel_select acima dá acesso. (EXECUTE foi revogado de PUBLIC
-- na auditoria SECURITY DEFINER de 09/09; mesmo tratamento já dado a cerebro_reader.)
GRANT EXECUTE ON FUNCTION public.user_org_id()          TO v4call_painel;
GRANT EXECUTE ON FUNCTION public.is_manager()           TO v4call_painel;
GRANT EXECUTE ON FUNCTION public.lead_visibility_mode() TO v4call_painel;

COMMIT;
