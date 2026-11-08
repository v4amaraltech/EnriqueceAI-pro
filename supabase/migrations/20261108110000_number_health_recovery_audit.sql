-- PR complementar ao PR10: auditoria permanente de recuperacao autorizada.
--
-- Aditiva e forward-only. Cria tabela append-only para trilha permanente de
-- recuperacoes autorizadas, sem apagar justificativa do gestor. RLS por org.
-- Escrita somente service_role. Nenhuma coluna do PR10 e alterada aqui.
--
-- Principios:
--   * Append-only permanente: cada recuperacao autorizada vira uma linha nova.
--     DELETE nunca e concedido. FK da instancia e NO ACTION: apagar o numero nao
--     apaga o historico de auditoria.
--   * Idempotencia: indice unico (instance_id, recovered_at). Repeticao do mesmo
--     instante (race, retry) e rejeitada pelo banco; o servico a trata como
--     duplicado, sem somar duas vezes.
--   * Campos gravados: ator (user_id), timestamp, justificativa (note), motivo
--     da pausa (pause_reason), estados anterior e novo, estagio e tetos no momento
--     da recuperacao. Somente ids, codigos e numeros; sem telefone, nome ou corpo
--     de mensagem.
--   * Nenhum segredo e gravado; jamais apagar historico ou inteligencia.
--   * Recuperacao e auditoria sao transacionais e consistentes: a linha so e inserida
--     se a atualizacao da instancia for bem-sucedida (CAS por health_state); se a
--     insercao falhar (duplicado), a recuperacao e abortada.

BEGIN;

-- 1. whatsapp_number_health_recoveries: auditoria permanente --------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_number_health_recoveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NO ACTION: apagar o numero nao apaga o historico de auditoria.
  instance_id          uuid NOT NULL REFERENCES public.whatsapp_instances(id),
  -- Gestor que autorizou a recuperacao.
  actor_user_id        uuid NOT NULL REFERENCES public.users(id),
  -- Justificativa fornecida pelo gestor (minimo 10 caracteres validado no servico).
  note                 text NOT NULL,
  -- Estado anterior (paused ou review).
  previous_state       text NOT NULL,
  -- Estado novo apos recuperacao (warming).
  new_state            text NOT NULL,
  -- Motivo da pausa que levou a este bloqueio.
  pause_reason         text,
  -- Estagio da rampa no momento da recuperacao (preservado).
  ramp_stage           integer NOT NULL,
  -- Tetos no momento da recuperacao (preservados).
  new_contacts_cap     integer NOT NULL,
  total_cap            integer NOT NULL,
  -- Instante da recuperacao autorizada (chave de idempotencia).
  recovered_at         timestamptz NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_number_health_recoveries_previous_state_chk
    CHECK (previous_state IN ('paused', 'review')),
  CONSTRAINT whatsapp_number_health_recoveries_new_state_chk
    CHECK (new_state = 'warming'),
  CONSTRAINT whatsapp_number_health_recoveries_note_chk
    CHECK (char_length(btrim(note)) >= 10),
  CONSTRAINT whatsapp_number_health_recoveries_caps_chk
    CHECK (
      ramp_stage BETWEEN 0 AND 20
      AND new_contacts_cap BETWEEN 0 AND 1000
      AND total_cap BETWEEN 0 AND 1000
      AND new_contacts_cap <= total_cap
    )
);

-- Idempotencia: mesma instancia e mesmo instante nao recuperam duas vezes.
CREATE UNIQUE INDEX IF NOT EXISTS ux_whatsapp_number_health_recoveries_instance_time
  ON public.whatsapp_number_health_recoveries (instance_id, recovered_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_health_recoveries_org
  ON public.whatsapp_number_health_recoveries (org_id, recovered_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_number_health_recoveries_actor
  ON public.whatsapp_number_health_recoveries (actor_user_id, recovered_at DESC);

ALTER TABLE public.whatsapp_number_health_recoveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_number_health_recoveries_org_select ON public.whatsapp_number_health_recoveries;
CREATE POLICY whatsapp_number_health_recoveries_org_select ON public.whatsapp_number_health_recoveries
  FOR SELECT USING (org_id = (SELECT public.user_org_id()));

-- Append-only: permite apenas o DELETE em cascata de organizacao, instancia ou ator.
-- reject_append_only_mutation vem do PR05 (20261107150000).
DROP TRIGGER IF EXISTS whatsapp_number_health_recoveries_append_only ON public.whatsapp_number_health_recoveries;
CREATE TRIGGER whatsapp_number_health_recoveries_append_only
  BEFORE UPDATE OR DELETE ON public.whatsapp_number_health_recoveries
  FOR EACH ROW EXECUTE FUNCTION public.reject_append_only_mutation();

-- Sem DELETE para ninguem. Escrita so service_role.
REVOKE ALL ON public.whatsapp_number_health_recoveries FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.whatsapp_number_health_recoveries TO authenticated;
GRANT SELECT, INSERT ON public.whatsapp_number_health_recoveries TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
