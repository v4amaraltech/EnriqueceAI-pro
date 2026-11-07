-- WhatsApp automático pela Evolution, cadenciado por número do SDR
-- Story: docs/stories/whatsapp-evolution-paced-sending.story.md (PR 1)
--
-- 1. cadence_steps.auto_send: passo de WhatsApp marcado para sair sozinho.
-- 2. whatsapp_instances.auto_send_*: limite diário com aquecimento, próximo
--    envio permitido (intervalo aleatório) e freio por número.
-- 3. whatsapp_send_queue: fila por número do SDR (1 item por inscrição + passo).
-- 4. cron process-whatsapp-queue: a cada minuto, 8h–18h BRT, seg–sex. Clona a
--    autenticação do job execute-cadence-steps já existente — nenhum segredo
--    neste arquivo. Se o job de referência não existir (ambiente local), não agenda.

BEGIN;

-- 1. Passo automático -------------------------------------------------------
ALTER TABLE public.cadence_steps
  ADD COLUMN IF NOT EXISTS auto_send BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.cadence_steps.auto_send IS
  'Passo de WhatsApp enviado automaticamente pela fila do número do SDR (whatsapp_send_queue). Só vale para channel = whatsapp.';

-- 2. Controle por número ----------------------------------------------------
ALTER TABLE public.whatsapp_instances
  ADD COLUMN IF NOT EXISTS auto_send_daily_limit INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS auto_send_limit_changed_on DATE,
  ADD COLUMN IF NOT EXISTS auto_send_next_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_send_consecutive_failures INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_send_paused_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auto_send_pause_reason TEXT;

ALTER TABLE public.whatsapp_instances
  DROP CONSTRAINT IF EXISTS whatsapp_instances_auto_send_daily_limit_check;
ALTER TABLE public.whatsapp_instances
  ADD CONSTRAINT whatsapp_instances_auto_send_daily_limit_check
  CHECK (auto_send_daily_limit BETWEEN 0 AND 200);

COMMENT ON COLUMN public.whatsapp_instances.auto_send_daily_limit IS
  'Contatos novos por dia no envio automático. Aquecimento: 20 → +10 a cada 3 dias úteis sem incidente → 80.';
COMMENT ON COLUMN public.whatsapp_instances.auto_send_next_at IS
  'Antes disso a fila deste número não envia (intervalo aleatório de 2 a 6 min entre envios).';
COMMENT ON COLUMN public.whatsapp_instances.auto_send_paused_at IS
  'Freio: fila do número pausada (desconexão, falhas seguidas, muitos números inválidos ou pausa manual). Retomar é manual.';

-- 3. Fila -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_send_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  sender_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  enrollment_id UUID REFERENCES public.cadence_enrollments(id) ON DELETE CASCADE NOT NULL,
  cadence_id UUID REFERENCES public.cadences(id) ON DELETE CASCADE NOT NULL,
  step_id UUID REFERENCES public.cadence_steps(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped', 'canceled')),
  reason TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  counts_toward_limit BOOLEAN NOT NULL DEFAULT true,
  interaction_id UUID REFERENCES public.interactions(id) ON DELETE SET NULL,
  external_id TEXT,
  claimed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT whatsapp_send_queue_enrollment_step_key UNIQUE (enrollment_id, step_id)
);

COMMENT ON TABLE public.whatsapp_send_queue IS
  'Fila do WhatsApp automático: 1 item por inscrição + passo, enviado pelo número do SDR dono do lead, respeitando limite diário, intervalo e janela comercial.';

CREATE INDEX IF NOT EXISTS idx_whatsapp_send_queue_sender_status
  ON public.whatsapp_send_queue (sender_user_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_queue_org_status
  ON public.whatsapp_send_queue (org_id, status);
CREATE INDEX IF NOT EXISTS idx_whatsapp_send_queue_sent_at
  ON public.whatsapp_send_queue (sender_user_id, sent_at)
  WHERE sent_at IS NOT NULL;

ALTER TABLE public.whatsapp_send_queue ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON public.whatsapp_send_queue;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.whatsapp_send_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Leitura: gestor vê a org; SDR só a própria fila. Escrita só pelo service role
-- (cron e server actions), por isso não há policy de INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS whatsapp_send_queue_select ON public.whatsapp_send_queue;
CREATE POLICY whatsapp_send_queue_select ON public.whatsapp_send_queue
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.user_org_id())
    AND ((SELECT public.is_manager()) OR sender_user_id = (SELECT auth.uid()))
  );

REVOKE ALL ON public.whatsapp_send_queue FROM anon;
GRANT SELECT ON public.whatsapp_send_queue TO authenticated;

-- 4. Cron -------------------------------------------------------------------
DO $$
DECLARE
  v_ref TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RETURN;
  END IF;

  SELECT command INTO v_ref FROM cron.job WHERE jobname = 'execute-cadence-steps';
  IF v_ref IS NULL OR position('/api/cron/execute-cadence-steps' IN v_ref) = 0 THEN
    RAISE NOTICE 'execute-cadence-steps não encontrado — process-whatsapp-queue não agendado';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-queue') THEN
    PERFORM cron.unschedule('process-whatsapp-queue');
  END IF;

  -- 11h–20h59 UTC = 8h–17h59 BRT; a regra de janela no app é a fonte da verdade.
  PERFORM cron.schedule(
    'process-whatsapp-queue',
    '* 11-20 * * 1-5',
    replace(v_ref, '/api/cron/execute-cadence-steps', '/api/cron/process-whatsapp-queue')
  );
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
