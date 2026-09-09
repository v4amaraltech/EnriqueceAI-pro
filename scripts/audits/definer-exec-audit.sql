-- ============================================================================
-- Auditoria: EXECUTE em funções SECURITY DEFINER
-- ============================================================================
--
-- USO
--   Rodar no SQL editor do Supabase (ou via MCP) DEPOIS de qualquer migration que
--   crie, recrie ou dropE uma função SECURITY DEFINER — e periodicamente.
--
--   O resultado da Query 1 tem de bater exatamente com a lista de
--   `supabase/security/definer-exec-allowlist.json`. Qualquer nome a mais é um
--   achado: uma função com privilégio do dono, alcançável por qualquer usuário
--   logado (ou anônimo) via POST /rest/v1/rpc/<nome>.
--
-- POR QUE ISTO EXISTE
--   Um DROP + CREATE descarta a ACL da função e a recria com o default privilege
--   do schema public, que concede EXECUTE a PUBLIC. O REVOKE de uma migration
--   antiga NÃO sobrevive: ele agiu sobre o objeto, não sobre o nome. Foi o que
--   aconteceu em 20260909184311 com fetch_inactive_enrollment_candidates.
--
--   O CI cobre o lado do repositório (tests/security/definer-acl.test.ts); este
--   script cobre o lado do banco. `{"success": true}` numa migration não prova
--   que a permissão ficou correta — só a leitura de proacl prova.
--
-- Contexto e classificação: docs/stories/security-definer-execute-audit.story.md
-- ============================================================================


-- ----------------------------------------------------------------------------
-- Query 1 — O QUE ESTÁ EXPOSTO HOJE (comparar com a allowlist)
-- ----------------------------------------------------------------------------
--
-- Atenção ao `=X/postgres` em proacl: é o grant a PUBLIC, e PUBLIC inclui anon e
-- authenticated. Uma função pode não listar `anon=X` e ainda assim ser chamável
-- por anon — por isso a coluna de verdade é has_function_privilege(), não proacl.

SELECT
  p.proname                                                    AS funcao,
  pg_get_function_identity_arguments(p.oid)                    AS assinatura,
  has_function_privilege('anon', p.oid, 'EXECUTE')             AS anon_exec,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')    AS auth_exec,
  (p.proacl IS NULL)                                           AS acl_default_publica,
  COALESCE(p.proacl::text, 'NULL (default do schema = PUBLIC)') AS proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND (
    has_function_privilege('anon', p.oid, 'EXECUTE')
    OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
  )
ORDER BY p.proname;


-- ----------------------------------------------------------------------------
-- Query 2 — FUNÇÕES USADAS DENTRO DE POLICIES RLS (nunca revogar EXECUTE)
-- ----------------------------------------------------------------------------
--
-- Rodar ANTES de propor qualquer revoke. Revogar um helper usado em policy
-- derruba a aplicação inteira; se o helper perder o grant de `authenticator` ou
-- `supabase_realtime_admin`, derruba o Realtime junto (incidente
-- realtime-rls-helper-execute-revoked).

WITH secdef AS (
  SELECT p.oid, p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prosecdef
),
pol AS (
  SELECT
    schemaname || '.' || tablename || '.' || policyname AS pname,
    COALESCE(qual, '') || ' ' || COALESCE(with_check, '') AS expr
  FROM pg_policies
)
SELECT
  s.proname            AS helper,
  count(*)::int        AS policies_que_usam,
  string_agg(DISTINCT p.pname, ', ' ORDER BY p.pname) AS exemplos
FROM secdef s
JOIN pol p ON p.expr ~ ('\y' || s.proname || '\s*\(')
GROUP BY s.proname
ORDER BY 2 DESC;


-- ----------------------------------------------------------------------------
-- Query 3 — GRANTS DOS HELPERS DE RLS (conferir que continuam completos)
-- ----------------------------------------------------------------------------

SELECT
  p.proname,
  has_function_privilege('authenticated', p.oid, 'EXECUTE')            AS authenticated,
  has_function_privilege('anon', p.oid, 'EXECUTE')                     AS anon,
  has_function_privilege('authenticator', p.oid, 'EXECUTE')            AS authenticator,
  has_function_privilege('supabase_realtime_admin', p.oid, 'EXECUTE')  AS realtime_admin,
  has_function_privilege('service_role', p.oid, 'EXECUTE')             AS service_role
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('user_org_id', 'is_manager', 'lead_visibility_mode')
ORDER BY p.proname;


-- ----------------------------------------------------------------------------
-- Query 4 — SANIDADE: service_role mantém EXECUTE em tudo
-- ----------------------------------------------------------------------------
--
-- O cron (pg_cron roda como postgres), as Edge Functions e os fluxos n8n usam
-- service_role. Se algum REVOKE tiver pego service_role por engano, aparece aqui.
-- Resultado esperado: zero linhas.

SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS assinatura, p.proacl::text
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
ORDER BY p.proname;


-- ----------------------------------------------------------------------------
-- Query 5 — QUEM DE FATO CHAMA CADA RPC (não roda aqui: é log, não SQL do banco)
-- ----------------------------------------------------------------------------
--
-- A classificação estática erra: em 09/09/2026 três funções pareciam órfãs e
-- estavam em uso pelo Sales Hub com `anon`. Antes de revogar, confira o tráfego
-- real na API de logs do Supabase (retenção depende do plano — 7 dias no atual):
--
--   GET https://api.supabase.com/v1/projects/<ref>/analytics/endpoints/logs.all
--       ?sql=<query>&iso_timestamp_start=...&iso_timestamp_end=...
--
--   select r.path as path, p.role as role, rc.status_code as status, count(*) as n
--   from edge_logs t
--   cross join unnest(t.metadata) as m
--   cross join unnest(m.request) as r
--   cross join unnest(m.response) as rc
--   cross join unnest(r.sb) as sb
--   cross join unnest(sb.jwt) as j
--   cross join unnest(j.authorization) as a
--   cross join unnest(a.payload) as p
--   where r.path like '%/rpc/%'
--   group by path, role, status
--   order by n desc
--
-- Uma função com chamadas `anon` ou `authenticated` retornando 200 está em uso
-- por um cliente: revogar derruba esse cliente. Trate-a com guarda de tenant ou
-- shared secret em vez de revoke cego.
-- ============================================================================
