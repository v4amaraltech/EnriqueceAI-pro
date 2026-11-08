-- PR11 do motor de contato (docs/architecture/call-cockpit-engine.md, secao 13):
-- trilha de decisao do score de prioridade v2.
--
-- Aditiva e forward-only. Nao altera tabelas existentes, nao faz backfill. Nada
-- aqui e lido nem escrito enquanto a flag `call_priority_v2` (app_flags, global)
-- estiver desligada; ela nasce desligada.
--
-- decision_events e append-only (mesma funcao e mesmo padrao do PR05): cada sinal
-- observado, sugestao emitida e correcao humana vira uma linha nova. Correcao
-- humana nunca edita linha anterior; a mais recente prevalece na leitura.
--
-- Idempotencia: indice unico (org_id, idempotency_key). Repeticao do mesmo evento
-- (replay de webhook, reprocessamento) e rejeitada pelo banco e o servico a trata
-- como duplicado, sem somar duas vezes.
--
-- payload: somente ids, codigos e numeros (ex.: call_id, disposition, score). Sem
-- telefone, e-mail, nome, transcricao ou corpo de mensagem. O servico aplica uma
-- lista de chaves permitidas; aqui o banco limita forma e tamanho.
--
-- Escrita somente service_role. `authenticated` apenas le a propria organizacao.

BEGIN;

CREATE TABLE IF NOT EXISTS public.decision_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id          uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type       text NOT NULL,
  -- Versao do modelo ou da regra que produziu o evento (ex.: 'call_priority_v2.0').
  model_version    text NOT NULL,
  -- Origem do sinal: de onde veio a informacao.
  source           text NOT NULL,
  idempotency_key  text NOT NULL,
  payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Humano que originou o evento (correcao). NULL para eventos do sistema.
  actor_user_id    uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT decision_events_type_chk
    CHECK (event_type IN ('signal_observed', 'priority_suggestion', 'human_correction')),
  CONSTRAINT decision_events_source_chk
    CHECK (source IN (
      'explicit_reply', 'call_outcome_sdr',
      'transcript_classification', 'bant', 'send_effort', 'human', 'system'
    )),
  CONSTRAINT decision_events_version_chk CHECK (model_version <> '' AND model_version = btrim(model_version)),
  CONSTRAINT decision_events_key_chk
    CHECK (idempotency_key <> '' AND idempotency_key = btrim(idempotency_key) AND length(idempotency_key) <= 200),
  CONSTRAINT decision_events_payload_chk
    CHECK (jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 4096),
  CONSTRAINT decision_events_human_actor_chk
    CHECK (event_type <> 'human_correction' OR actor_user_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_decision_events_idempotency
  ON public.decision_events (org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_decision_events_lead
  ON public.decision_events (org_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_events_type
  ON public.decision_events (org_id, event_type, created_at DESC);

ALTER TABLE public.decision_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS decision_events_org_select ON public.decision_events;
CREATE POLICY decision_events_org_select ON public.decision_events
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- Append-only. `reject_append_only_mutation()` vem da migration do PR05
-- (20261107150000) e permite apenas o DELETE em cascata de organizacao ou lead.
DROP TRIGGER IF EXISTS decision_events_append_only ON public.decision_events;
CREATE TRIGGER decision_events_append_only
  BEFORE UPDATE OR DELETE ON public.decision_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

REVOKE ALL ON public.decision_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.decision_events TO authenticated;
GRANT SELECT, INSERT ON public.decision_events TO service_role;

-- Flag (nasce DESLIGADA; escopo global como as demais flags de app_flags).
INSERT INTO public.app_flags (key, enabled, note)
VALUES ('call_priority_v2', false, 'PR11: score de prioridade v2 e trilha decision_events')
ON CONFLICT (key) DO NOTHING;

COMMIT;

NOTIFY pgrst, 'reload schema';
