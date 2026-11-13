BEGIN;

-- Merge atômico de chaves em calls.metadata (metadata || patch), no banco.
--
-- NÃO aplicar em produção neste PR. Aplicar junto com o deploy, depois do PR aprovado,
-- e ANTES do merge do código (o Coolify faz auto-deploy no merge). Se o código subir
-- antes desta função, todos os escritores de calls.metadata passam a falhar
-- (audio_stats, live_amd, marcador do CRM automático, ai_outcome, ids da API4COM).
--
-- Por quê: em 13/11/2026 o hangup_v1 gravou sdr_disposition = no_answer em ligações
-- NUMBER_CHANGED da V4 e, em 2 delas, o marcador metadata.crm_auto_update sumiu.
-- saveWebphoneCallAudio lia o metadata, mesclava audio_stats no JS e regravava o
-- objeto inteiro. O CRM automático escreveu o marcador no meio; o UPDATE do áudio
-- chegou depois e apagou o marcador. Mesclando aqui, cada UPDATE parte do metadata
-- atual da linha (o lock da linha serializa os escritores).
--
-- Merge raso de chave no topo: cada escritor manda SÓ as chaves que ele é dono
-- (ex.: {"audio_stats": {...}}), nunca o metadata inteiro relido. Chave que só existe
-- na linha fica; chave do patch substitui só aquela chave.
--
-- Parâmetros:
--   p_id                           ligação.
--   p_patch                        objeto jsonb com as chaves do escritor (obrigatório, objeto).
--   p_org_id                       quando informado, filtra por org.
--   p_sdr_disposition              quando informado, grava o desfecho no MESMO UPDATE
--                                  (CRM automático: desfecho e marcador atômicos).
--   p_only_if_disposition_null     guarda do CRM automático: só escreve se sdr_disposition IS NULL.
--   p_only_if_ai_outcome_status    guarda do claim da IA: só escreve se
--                                  metadata->ai_outcome->>status for igual a este valor.
--
-- Retorna true quando uma linha foi atualizada e false quando nenhuma linha passou
-- pelos filtros (ligação inexistente, outra org, RLS, ou guarda condicional falhou).
--
-- Só sdr_disposition é gravável junto porque é o único caso que exige atomicidade
-- com o metadata. Os demais escritores atualizam as próprias colunas em outro UPDATE.
--
-- SECURITY INVOKER: o RLS de calls continua valendo para o usuário autenticado
-- (actions do webphone). Webhooks, crons e o CRM automático rodam como service_role.
-- Aditiva: não altera tabela, view, política, flag nem dado existente.

CREATE OR REPLACE FUNCTION public.merge_calls_metadata(
  p_id uuid,
  p_patch jsonb,
  p_org_id uuid DEFAULT NULL,
  p_sdr_disposition public.call_disposition DEFAULT NULL,
  p_only_if_disposition_null boolean DEFAULT false,
  p_only_if_ai_outcome_status text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'merge_calls_metadata: p_patch precisa ser um objeto jsonb'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.calls c
     SET metadata = COALESCE(c.metadata, '{}'::jsonb) || p_patch,
         sdr_disposition = COALESCE(p_sdr_disposition, c.sdr_disposition),
         updated_at = now()
   WHERE c.id = p_id
     AND (p_org_id IS NULL OR c.org_id = p_org_id)
     AND (NOT COALESCE(p_only_if_disposition_null, false) OR c.sdr_disposition IS NULL)
     AND (
       p_only_if_ai_outcome_status IS NULL
       OR c.metadata -> 'ai_outcome' ->> 'status' = p_only_if_ai_outcome_status
     );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.merge_calls_metadata(uuid, jsonb, uuid, public.call_disposition, boolean, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.merge_calls_metadata(uuid, jsonb, uuid, public.call_disposition, boolean, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.merge_calls_metadata(uuid, jsonb, uuid, public.call_disposition, boolean, text) IS
  'Mescla p_patch em calls.metadata (metadata || patch) sem sobrescrever chaves gravadas em paralelo. '
  'Opcional: grava sdr_disposition no mesmo UPDATE, com guarda sdr_disposition IS NULL, e guarda de '
  'metadata.ai_outcome.status. Retorna true se atualizou a linha. SECURITY INVOKER (RLS de calls vale).';

COMMIT;
