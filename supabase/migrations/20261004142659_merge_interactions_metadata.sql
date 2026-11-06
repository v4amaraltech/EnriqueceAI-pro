-- Mescla chaves no interactions.metadata dentro do banco (metadata || patch).
--
-- Por quê: o cron check-email-replies carimba `reply_checked_at` (rodízio) e
-- `sender_user_id` (caixa Gmail que tem a conversa) em ~100 envios por rodada.
-- Fazer isso no JS (ler metadata → regravar o JSON inteiro) apagava aberturas e
-- cliques que as rotas /api/track/open e /api/track/click gravassem no meio da
-- rodada — e a próxima abertura viraria "a primeira" de novo, duplicando a
-- métrica. Mesclando aqui, cada UPDATE vê o metadata atual da linha.
--
-- p_items: [{"id": "<uuid>", "patch": {...}}, ...] — uma chamada por rodada.
-- Só o service_role (crons) chama; SECURITY INVOKER, sem acesso de anon/authenticated.

BEGIN;

CREATE OR REPLACE FUNCTION public.merge_interactions_metadata(p_items jsonb)
RETURNS integer
LANGUAGE sql
SET search_path = public
AS $$
  WITH upd AS (
    UPDATE public.interactions i
       SET metadata = COALESCE(i.metadata, '{}'::jsonb) || x.patch
      FROM jsonb_to_recordset(p_items) AS x(id uuid, patch jsonb)
     WHERE i.id = x.id
       AND x.patch IS NOT NULL
    RETURNING 1
  )
  SELECT count(*)::integer FROM upd;
$$;

REVOKE ALL ON FUNCTION public.merge_interactions_metadata(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_interactions_metadata(jsonb) TO service_role;

COMMENT ON FUNCTION public.merge_interactions_metadata(jsonb) IS
  'Mescla patches em interactions.metadata (metadata || patch) sem sobrescrever chaves gravadas em paralelo. Usado pelo cron check-email-replies. Só service_role.';

COMMIT;
