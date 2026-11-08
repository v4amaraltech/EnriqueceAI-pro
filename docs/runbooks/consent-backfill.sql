-- Carga unica de consentimento de WhatsApp para os leads atuais
-- ============================================================
-- NAO EXECUTAR EM PRODUCAO sem revisao e aprovacao. Este arquivo so foi escrito, nunca rodado.
--
-- O que faz (somente INSERT em contact_consent_evidence, append-only, idempotente):
--   source 'backfill_form'    -> opt_in para lead de origem formulario/LP inbound com telefone.
--   source 'backfill_inbound' -> opt_in para lead que escreveu primeiro no WhatsApp
--                                (primeira interacao de WhatsApp do lead e uma resposta dele).
--
-- Como usar:
--   1. Rode so a PARTE 1 (view temporaria + contagem) e confira os numeros por org e origem.
--   2. Revise o criterio de origem na view (ver "AJUSTE" abaixo).
--   3. So depois rode a PARTE 2 (os dois INSERT), de preferencia em uma org por vez
--      (descomente o filtro de org). Reexecutar nao duplica: cada INSERT usa WHERE NOT EXISTS.
--
-- Garantias de seguranca da carga:
--   - Nunca grava opt_in para identidade que ja tenha QUALQUER opt_out (opt_out vence).
--   - Exclui leads com hold 'total' e leads cuja resposta inbound parece pedido para parar.
--   - Exclui quem so respondeu depois de um envio nosso (responder nao e pedir contato).
--   - Identidade = digitos do telefone, com prefixo 55 quando tem 10 ou 11 digitos
--     (mesma regra de canonicalWhatsappIdentity no servico).
--   - Evidencia guarda so referencias (id do lead, id da interacao). Sem corpo de mensagem.
--   - 'backfill_form' e 'backfill_inbound' NAO estao em CONTACT_REQUEST_SOURCES do gateway:
--     nao liberam a continuidade via Evolution.
--   - Comeca a valer no gateway so com conversation_ownership_v1 ligada para a org.
--
-- ATENCAO (juridico): hoje os formularios nao registram o aceite. O 'backfill_form' trata
-- "veio de formulario inbound com telefone" como consentimento presumido. Valide com o juridico
-- antes de rodar, ou restrinja o criterio de origem na view.

-- ---------------------------------------------------------------------------
-- PARTE 1: candidatos (view temporaria, some ao fechar a sessao) e contagem
-- ---------------------------------------------------------------------------
-- Rode a PARTE 1 e a PARTE 2 na MESMA sessao (a view e temporaria).

CREATE OR REPLACE TEMP VIEW consent_backfill_base AS
SELECT
  l.id        AS lead_id,
  l.org_id,
  l.is_inbound,
  COALESCE(NULLIF(btrim(l.canal), ''), NULLIF(btrim(l.lead_source), ''), 'sem_origem') AS origem,
  CASE
    WHEN length(d.digits) IN (10, 11) THEN '55' || d.digits
    WHEN length(d.digits) BETWEEN 12 AND 15 THEN d.digits
  END AS identity,
  l.created_at AS lead_created_at
FROM public.leads l
CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(l.telefone, ''), '\D', '', 'g') AS digits) d
WHERE l.deleted_at IS NULL
  -- AJUSTE: se "formulario/LP" precisar de um recorte mais estreito que is_inbound, filtre aqui
  -- por canal/lead_source (a contagem abaixo mostra as origens existentes).
  -- AND l.org_id = '<ORG_ID>'::uuid
;

CREATE OR REPLACE TEMP VIEW consent_backfill_candidatos AS
WITH base AS (
  SELECT * FROM consent_backfill_base WHERE identity IS NOT NULL
),
primeira_resposta AS (
  -- Primeira resposta inbound de WhatsApp de cada lead.
  SELECT DISTINCT ON (i.lead_id) i.lead_id, i.id AS interaction_id, i.created_at AS replied_at
  FROM public.interactions i
  WHERE i.channel = 'whatsapp' AND i.type = 'replied'
  ORDER BY i.lead_id, i.created_at ASC, i.id ASC
),
escreveu_primeiro AS (
  SELECT p.lead_id, p.interaction_id
  FROM primeira_resposta p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.interactions o
    WHERE o.lead_id = p.lead_id
      AND o.channel = 'whatsapp'
      AND o.type <> 'replied'
      AND o.created_at <= p.replied_at
  )
),
pediu_para_parar AS (
  SELECT DISTINCT i.lead_id
  FROM public.interactions i
  WHERE i.channel = 'whatsapp' AND i.type = 'replied'
    AND lower(translate(COALESCE(i.message_content, ''),
          'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç',
          'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc'))
        ~ '(\m(parar|pare|stop|sair|cancelar|descadastr\w*|unsubscribe)\M|para de (me )?(enviar|mandar|ligar|chamar|escrever|contatar)|nao (quero|desejo) (mais )?(receber|contato|mensagens?|ligacoes?)|nao me (mande|envie|chame|ligue|escreva|procure|contate) mais)'
)
SELECT
  b.org_id, b.lead_id, b.identity, b.origem, b.lead_created_at,
  b.is_inbound AS e_formulario_inbound,
  (ep.lead_id IS NOT NULL) AS escreveu_primeiro,
  ep.interaction_id,
  (pp.lead_id IS NOT NULL) AS pediu_para_parar,
  EXISTS (SELECT 1 FROM public.contact_holds h
          WHERE h.lead_id = b.lead_id AND h.tipo = 'total') AS hold_total,
  EXISTS (SELECT 1 FROM public.contact_consent_evidence c
          WHERE c.org_id = b.org_id AND c.contact_identity = b.identity
            AND c.channel = 'whatsapp' AND c.kind = 'opt_out') AS ja_tem_opt_out
FROM base b
LEFT JOIN escreveu_primeiro ep ON ep.lead_id = b.lead_id
LEFT JOIN pediu_para_parar pp ON pp.lead_id = b.lead_id;

-- >>> CONTAGEM POR ORG E ORIGEM (conferir antes de qualquer INSERT) <<<
SELECT
  c.org_id,
  c.origem,
  count(*) FILTER (WHERE c.e_formulario_inbound)                                   AS leads_formulario_inbound,
  count(*) FILTER (WHERE c.e_formulario_inbound AND NOT c.pediu_para_parar
                     AND NOT c.hold_total AND NOT c.ja_tem_opt_out)               AS entram_backfill_form,
  count(*) FILTER (WHERE c.escreveu_primeiro)                                      AS leads_escreveram_primeiro,
  count(*) FILTER (WHERE c.escreveu_primeiro AND NOT c.pediu_para_parar
                     AND NOT c.hold_total AND NOT c.ja_tem_opt_out)               AS entram_backfill_inbound,
  count(*) FILTER (WHERE c.pediu_para_parar)                                       AS excluidos_pediram_para_parar,
  count(*) FILTER (WHERE c.hold_total)                                             AS excluidos_hold_total,
  count(*) FILTER (WHERE c.ja_tem_opt_out)                                         AS excluidos_opt_out_existente
FROM consent_backfill_candidatos c
GROUP BY c.org_id, c.origem
ORDER BY c.org_id, c.origem;

-- ---------------------------------------------------------------------------
-- PARTE 2: INSERTs (somente INSERT ... WHERE NOT EXISTS). PARE AQUI ate conferir a contagem.
-- ---------------------------------------------------------------------------

BEGIN;

-- 2a. backfill_form: lead de formulario/LP inbound com telefone valido.
INSERT INTO public.contact_consent_evidence
  (org_id, lead_id, contact_identity, channel, kind, source, evidence, created_by)
SELECT DISTINCT ON (c.org_id, c.identity)
  c.org_id, c.lead_id, c.identity, 'whatsapp', 'opt_in', 'backfill_form',
  jsonb_build_object('ref', 'backfill_form:' || c.lead_id::text,
                     'lead_id', c.lead_id::text,
                     'origem', c.origem),
  NULL
FROM consent_backfill_candidatos c
WHERE c.e_formulario_inbound
  AND NOT c.pediu_para_parar
  AND NOT c.hold_total
  AND NOT c.ja_tem_opt_out
  -- AND c.org_id = '<ORG_ID>'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_consent_evidence e
    WHERE e.org_id = c.org_id
      AND e.contact_identity = c.identity
      AND e.channel = 'whatsapp'
      AND e.kind = 'opt_in'
      AND e.source = 'backfill_form'
  )
ORDER BY c.org_id, c.identity, c.lead_created_at ASC, c.lead_id;

-- 2b. backfill_inbound: lead que escreveu primeiro no WhatsApp (ja tem interacao inbound).
INSERT INTO public.contact_consent_evidence
  (org_id, lead_id, contact_identity, channel, kind, source, evidence, created_by)
SELECT DISTINCT ON (c.org_id, c.identity)
  c.org_id, c.lead_id, c.identity, 'whatsapp', 'opt_in', 'backfill_inbound',
  jsonb_build_object('ref', 'backfill_inbound:' || c.lead_id::text,
                     'lead_id', c.lead_id::text,
                     'interaction_id', c.interaction_id::text),
  NULL
FROM consent_backfill_candidatos c
WHERE c.escreveu_primeiro
  AND NOT c.pediu_para_parar
  AND NOT c.hold_total
  AND NOT c.ja_tem_opt_out
  -- AND c.org_id = '<ORG_ID>'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM public.contact_consent_evidence e
    WHERE e.org_id = c.org_id
      AND e.contact_identity = c.identity
      AND e.channel = 'whatsapp'
      AND e.kind = 'opt_in'
      AND e.source = 'backfill_inbound'
  )
ORDER BY c.org_id, c.identity, c.lead_created_at ASC, c.lead_id;

COMMIT;
