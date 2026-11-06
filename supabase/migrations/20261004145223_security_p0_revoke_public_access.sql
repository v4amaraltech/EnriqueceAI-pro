-- Pacote de segurança P0 (auditoria de 04/10/2026): fecha o que a chave anon
-- (pública, vai em todo navegador) e qualquer usuário logado conseguiam ler ou
-- executar direto pela API REST, sem passar pela aplicação.
--
-- Uso conferido nos edge_logs (02–04/10) antes de revogar: views e funções abaixo
-- só são chamadas por service_role (app/n8n) ou por nenhum cliente REST.
-- service_role mantém o acesso.
--
-- FORA deste pacote, de propósito: get_sdr_atividades_atrasadas_v3,
-- get_sdr_leads_para_abrir_v2 e get_sdr_leads_abertos — o Sales Hub chama com a
-- chave anon pelo navegador; revogar só quando ele mandar p_api_token
-- (migration 20260909210100, pendente).
--
-- Usa REVOKE/GRANT (nunca DROP + CREATE: recriar uma função SECURITY DEFINER
-- reconcede EXECUTE a PUBLIC pelo default privilege do schema).

BEGIN;

-- 1. Funções SECURITY DEFINER executáveis por anon/authenticated.
--    atualizar_convite_reuniao: altera a reunião de qualquer lead de qualquer org,
--    sem checar org (criada direto em prod, fora do repo).
--    *_email_conversation*: trava/destrava a conversa do agente BDR — anon podia
--    travar para sempre (lease enorme) ou soltar a trava de outro executor.
--    trg_dispatch_log_registra_confirmacao: função de trigger, não é RPC.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN (
         'atualizar_convite_reuniao',
         'claim_email_conversation',
         'renew_email_conversation_lock',
         'release_email_conversation_lock',
         'trg_dispatch_log_registra_confirmacao'
       )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn);
  END LOOP;
END $$;

-- 2. Views SECURITY DEFINER (ignoram o RLS de quem consulta) legíveis pela API.
--    vw_sla_qualificacao_sdr expunha auth.users a qualquer usuário logado.
DO $$
DECLARE
  v text;
BEGIN
  FOREACH v IN ARRAY ARRAY[
    'v_meeting_webhook_candidates',
    'vw_confirmacao_ligacao_hoje',
    'vw_entrega_por_numero',
    'vw_mb_indicacoes',
    'vw_no_show_fora_do_retrovisor',
    'vw_no_show_para_ligar',
    'vw_no_show_para_remarcar',
    'vw_sla_qualificacao_sdr'
  ]
  LOOP
    IF to_regclass(format('public.%I', v)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', v);
      EXECUTE format('GRANT SELECT ON public.%I TO service_role', v);
    END IF;
  END LOOP;
END $$;

-- 3. Tabelas de backup (_bkp_*): 17 sem RLS e 20 com acesso total de anon, com
--    dados de leads. RLS ligado sem policy + REVOKE = só service_role/postgres
--    (e leitores BYPASSRLS como cerebro_reader) enxergam. Pega todas as _bkp_*
--    existentes no momento da aplicação.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname LIKE '\_bkp\_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
  END LOOP;
END $$;

COMMIT;
