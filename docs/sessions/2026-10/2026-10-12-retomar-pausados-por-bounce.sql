-- Passivo da story paused-cadence-limbo (12/out/2026).
-- RODAR SÓ DEPOIS DO DEPLOY: sem o motor pulando passos de e-mail, a inscrição
-- reativada voltaria a mostrar o passo de e-mail de um endereço com bounce.
--
-- Alvo: inscrições pausadas pelo antigo `recordBounce` (pausava TODAS as outras
-- cadências do lead). Assinatura: lead com bounce, inscrição `paused` sem data
-- de volta, sem evento `cadence_paused` (o bounce não registrava nada) e
-- atualizada no mesmo minuto da interação `bounced`. Em 12/out eram 8
-- (7 Inbound 2.0 + 1 BDR IA — Arroz (contato)).

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_bounce_paused_resume_20261012 AS
SELECT ce.id, ce.lead_id, ce.cadence_id, ce.status, ce.current_step, ce.next_step_due, ce.updated_at, now() AS backed_up_at
FROM cadence_enrollments ce
JOIN leads l ON l.id = ce.lead_id
WHERE ce.status = 'paused'
  AND ce.scheduled_start_at IS NULL
  AND l.deleted_at IS NULL
  AND l.email_bounced_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM interactions i
    WHERE i.lead_id = ce.lead_id AND i.type = 'bounced'
      AND i.created_at BETWEEN ce.updated_at - interval '1 minute' AND ce.updated_at + interval '1 minute'
  )
  AND NOT EXISTS (
    SELECT 1 FROM interactions p
    WHERE p.lead_id = ce.lead_id AND p.channel = 'system'
      AND p.metadata->>'system_event' = 'cadence_paused'
      AND p.created_at >= ce.updated_at - interval '1 minute'
  );

-- Backup nasce fechado (lição do pacote de segurança de 04/out).
ALTER TABLE public._bkp_bounce_paused_resume_20261012 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_bounce_paused_resume_20261012 FROM anon, authenticated;

SELECT count(*) AS alvo FROM public._bkp_bounce_paused_resume_20261012; -- esperado ~8

UPDATE cadence_enrollments ce
SET status = 'active'
FROM public._bkp_bounce_paused_resume_20261012 b
WHERE ce.id = b.id AND ce.status = 'paused';

INSERT INTO interactions (org_id, lead_id, cadence_id, channel, type, performed_by, metadata)
SELECT ce.org_id, ce.lead_id, ce.cadence_id, 'system', 'sent', NULL,
       jsonb_build_object('system_event', 'cadence_resumed', 'reason', 'bounce_no_longer_pauses',
                          'fix', 'paused-cadence-limbo', 'enrollment_id', ce.id)
FROM cadence_enrollments ce
JOIN public._bkp_bounce_paused_resume_20261012 b ON b.id = ce.id;

COMMIT;

-- Reversão:
-- UPDATE cadence_enrollments ce SET status = 'paused'
-- FROM public._bkp_bounce_paused_resume_20261012 b WHERE ce.id = b.id;
-- Dropar o backup após 11/nov/2026.
