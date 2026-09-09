-- ============================================================================
-- Auditoria de EXECUTE em funções SECURITY DEFINER
-- Story: docs/stories/security-definer-execute-audit.story.md
-- ============================================================================
--
-- CONTEXTO
--
-- `20260909184311_auto_loss_after_cadence_completed.sql` recriou
-- `fetch_inactive_enrollment_candidates` com DROP + CREATE. O DROP descartou a
-- ACL da função e o CREATE a recriou com o default privilege do schema public,
-- que concede EXECUTE a PUBLIC — ou seja, a anon e authenticated. O REVOKE de
-- `20260516160057_revoke_definer_anon_authenticated_exec.sql` não sobreviveu:
-- REVOKE age sobre o objeto, não sobre o nome. Corrigido em `20260909184517`.
--
-- Esta migration trata das demais funções do schema. Levantamento de 09/09/2026:
-- 64 funções prosecdef em public, 42 executáveis por authenticated e 36 por anon.
--
-- CRITÉRIO
--
-- Revogada aqui a função que lê ou escreve dados de várias orgs sem filtro de
-- tenant (classe "a"), ou que recebe org/usuário por parâmetro sem validar
-- contra o chamador (classe "b"). Nenhuma delas tem call site no código da
-- aplicação, e os logs do PostgREST dos últimos 7 dias mostram que todas as
-- chamadas observadas chegam com service_role — que mantém o grant.
--
-- NÃO tocadas: `user_org_id()`, `is_manager()` e `lead_visibility_mode()`, os
-- helpers usados dentro de 166, 63 e 2 policies RLS. Revogar EXECUTE deles
-- derruba a aplicação inteira e o Realtime — ver o incidente registrado em
-- `realtime-rls-helper-execute-revoked`.
--
-- NOTA SOBRE PUBLIC: `=X/postgres` em proacl é o grant a PUBLIC, e PUBLIC inclui
-- anon e authenticated. `copiloto_match_lead` não lista `anon=X` e ainda assim
-- era chamável por anon. Por isso todo REVOKE aqui inclui PUBLIC.
--
-- REVERSÃO: se algo quebrar, `GRANT EXECUTE ON FUNCTION public.<assinatura> TO
-- authenticated;` restaura em segundos.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- (a) CRÍTICO — leitura ou escrita cross-tenant sem filtro
-- ----------------------------------------------------------------------------

-- Varrem `leads` de TODAS as orgs e devolvem PII completa (CNPJ, telefone,
-- faturamento, notes, BANT). `copiloto_match_lead` é enumerável por e-mail.
REVOKE EXECUTE ON FUNCTION public.copiloto_match_lead(p_emails text[]) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.copiloto_leads_qualificacao(p_lead_ids uuid[]) FROM anon, authenticated, PUBLIC;

-- PII completa do lead + e-mail do SDR lido de auth.users, sem filtro de org.
REVOKE EXECUTE ON FUNCTION public.dados_para_novo_evento(p_lead_id text) FROM anon, authenticated, PUBLIC;

-- Org V4 hardcoded: dump de ligações com recording_url e transcription.
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(p_from_date text, p_limit integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales_by_ids(p_ids uuid[]) FROM anon, authenticated, PUBLIC;

-- Org V4 hardcoded, expõe e-mails de SDRs. Substituída pela v2 (Migration B).
REVOKE EXECUTE ON FUNCTION public.get_sdr_leads_para_abrir() FROM anon, authenticated, PUBLIC;

-- ESCRITA cross-tenant: UPDATE em leads / confirmacoes_reuniao / no_show_disparos
-- e INSERT em interactions, sem qualquer filtro de org.
REVOKE EXECUTE ON FUNCTION public.enriquecer_lead(p_lead_id uuid, p_data jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.aplicar_reagendamento(p_event_id text, p_novo_inicio timestamp with time zone) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_novo_evento_no_show(p_lead_id text, p_event_id text, p_inicio timestamp with time zone) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_interacao_confirmacao(p_wamid text, p_tipo text, p_telefone text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.marcar_resposta_no_show(p_wamid text, p_resposta text, p_telefone text) FROM anon, authenticated, PUBLIC;

-- Dispara net.http_post em loop (até 40 lotes) para endpoint externo, com a
-- apikey passada pelo chamador: exfiltração e abuso de saída.
REVOKE EXECUTE ON FUNCTION public.push_first_touch_to_v4sales(p_apikey text, p_from timestamp with time zone, p_batch integer) FROM anon, authenticated, PUBLIC;

-- ----------------------------------------------------------------------------
-- (b) ALTO — org/usuário por parâmetro sem validação contra o chamador
-- ----------------------------------------------------------------------------

-- Estas duas TÊM guarda `p_org_id <> user_org_id()`, mas o único call site
-- (getRankingData) usa createServiceRoleClient(): não precisam de authenticated.
REVOKE EXECUTE ON FUNCTION public.count_leads_opened_by_sdr(p_org_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_cadence_ids uuid[]) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.count_leads_opened_by_sdr_daily(p_org_id uuid, p_start timestamp with time zone, p_end timestamp with time zone, p_cadence_ids uuid[]) FROM anon, authenticated, PUBLIC;

-- Leitura e escrita livres em confirmacoes_reuniao / no_show_disparos /
-- numero_qualidade / mensagens_status, sem org.
REVOKE EXECUTE ON FUNCTION public.pode_enviar_confirmacao(p_event_id text, p_momento text, p_pular_se_confirmado boolean) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_envio_confirmacao(p_event_id text, p_lead_id text, p_telefone text, p_nome text, p_reuniao_em timestamp with time zone, p_calendar_id text, p_link text, p_responsavel text, p_momento text, p_wamid text, p_sdr text) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_disparo_no_show(p_lead_id text, p_meeting_starts_at timestamp with time zone, p_telefone text, p_nome text, p_wamid text, p_erro text, p_toque integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_qualidade_numero(p_evento text, p_phone_number text, p_de text, p_para text, p_detalhe jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_status_mensagem(p_eventos jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.registrar_status_mensagem(p_eventos jsonb, p_phone_number_id text, p_display_phone_number text) FROM anon, authenticated, PUBLIC;

-- UPDATE em leads de qualquer org.
REVOKE EXECUTE ON FUNCTION public.sync_lead_meeting_starts_at(p_lead_id uuid) FROM anon, authenticated, PUBLIC;

-- ----------------------------------------------------------------------------
-- Higiene — funções de trigger
-- ----------------------------------------------------------------------------
--
-- `RETURNS trigger` não é exposto pelo PostgREST, então o risco prático é nulo;
-- o EXECUTE para PUBLIC é resíduo do default privilege. O Postgres checa EXECUTE
-- no CREATE TRIGGER, não no disparo, então revogar não afeta os triggers.
REVOKE EXECUTE ON FUNCTION public.callface_events_process() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_primary_contact_from_lead() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enforce_enrollment_has_owner() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_primary_contact_to_lead() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_meeting_starts_at() FROM anon, authenticated, PUBLIC;

-- ----------------------------------------------------------------------------
-- MANTIDAS — chamadas legítimas do cliente autenticado
-- ----------------------------------------------------------------------------
--
-- Todas filtram por user_org_id() internamente ou validam p_org_id contra ele, e
-- são chamadas por Server Actions via createServerSupabaseClient() (role
-- authenticated). O que sai aqui é só o grant herdado de PUBLIC, redundante e
-- justamente o que o default privilege reconcede num DROP+CREATE. Os grants
-- ficam explícitos, para a auditoria enxergar.

REVOKE EXECUTE ON FUNCTION public.count_leads_by_loss_reason(p_org_id uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.count_leads_by_loss_reason(p_org_id uuid) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.set_primary_lead_contact(p_contact_id uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.set_primary_lead_contact(p_contact_id uuid) TO authenticated;

-- count_leads_by_status, get_distinct_lead_canais, get_distinct_lead_cnaes e
-- get_executed_steps já estão com grant explícito só a authenticated: nada a fazer.

-- ----------------------------------------------------------------------------
-- MANTIDAS — públicas por decisão de produto (Sales Hub), já com shared secret
-- ----------------------------------------------------------------------------
--
-- Guarda interna: caller de outra org, sem service_role e sem o token
-- `v4sales_public_rpc` → Forbidden (42501). Decisão documentada em
-- `20260516161116_protect_public_rpcs_with_shared_secret`. Aqui só se troca o
-- PUBLIC herdado por grants nominais.

REVOKE EXECUTE ON FUNCTION public.get_indicacoes_leads_lookup(p_api_token text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_indicacoes_leads_lookup(p_api_token text) TO anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.get_indicacoes_reunioes_realizadas(p_year integer, p_month integer, p_api_token text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_indicacoes_reunioes_realizadas(p_year integer, p_month integer, p_api_token text) TO anon, authenticated;

-- get_indicacoes_ranking e get_leads_for_v4sales já estão sem PUBLIC.

COMMIT;

-- ============================================================================
-- VERIFICAÇÃO OBRIGATÓRIA — rodar DEPOIS de aplicar.
-- O `{"success": true}` do MCP não prova que a permissão ficou correta.
--
--   select p.proname,
--          has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_exec,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
--          p.proacl::text
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prosecdef
--     and (has_function_privilege('anon', p.oid, 'EXECUTE')
--          or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
--   order by p.proname;
--
-- O resultado tem de bater exatamente com supabase/security/definer-exec-allowlist.json.
-- Script pronto: scripts/audits/definer-exec-audit.sql
-- ============================================================================
