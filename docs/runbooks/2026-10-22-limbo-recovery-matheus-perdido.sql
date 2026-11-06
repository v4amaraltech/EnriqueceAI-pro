-- Passivo do limbo de 22/out/2026 (decisão do Vini).
-- Alvo: leads em limbo cuja "Recovery — E-mail (auto)" está pausada sem data de
-- volta desde 14/set (Matheus Martins). Em 22/out eram 9.
-- Destino: Perdido "Nunca respondeu" (mesmo tratamento dos 13 do Agro em 12/out).

BEGIN;

CREATE TABLE IF NOT EXISTS public._bkp_limbo_recovery_matheus_20261022 AS
SELECT ce.id AS enrollment_id, ce.lead_id, ce.cadence_id, ce.status AS enr_status,
       ce.completed_at, ce.loss_reason_id AS enr_loss_reason_id,
       l.status AS lead_status, l.lost_at, l.loss_reason_id, now() AS backed_up_at
FROM cadence_enrollments ce
JOIN cadences c ON c.id = ce.cadence_id
JOIN public.v_leads_cadence_limbo l ON l.id = ce.lead_id
WHERE c.name = 'Recovery — E-mail (auto)'
  AND ce.status = 'paused'
  AND ce.scheduled_start_at IS NULL
  AND ce.updated_at < '2026-09-16';

-- Backup nasce fechado (lição do pacote de segurança de 04/out).
ALTER TABLE public._bkp_limbo_recovery_matheus_20261022 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_limbo_recovery_matheus_20261022 FROM anon, authenticated;

SELECT count(*) AS alvo FROM public._bkp_limbo_recovery_matheus_20261022; -- esperado 9

UPDATE cadence_enrollments ce
SET status = 'completed',
    completed_at = now(),
    loss_reason_id = lr.id
FROM public._bkp_limbo_recovery_matheus_20261022 b
JOIN leads l ON l.id = b.lead_id
JOIN loss_reasons lr ON lr.org_id = l.org_id AND lr.name = 'Nunca respondeu'
WHERE ce.id = b.enrollment_id AND ce.status = 'paused';

UPDATE leads l
SET status = 'unqualified',
    lost_at = now(),
    loss_reason_id = lr.id
FROM public._bkp_limbo_recovery_matheus_20261022 b
JOIN loss_reasons lr ON lr.name = 'Nunca respondeu'
WHERE l.id = b.lead_id AND lr.org_id = l.org_id AND l.status = 'contacted';

INSERT INTO interactions (org_id, lead_id, cadence_id, channel, type, performed_by, metadata)
SELECT l.org_id, b.lead_id, b.cadence_id, 'system', 'sent', NULL,
       jsonb_build_object('system_event', 'cadence_limbo_triaged',
                          'reason', 'recovery_paused_since_2026-09-14',
                          'loss_reason', 'Nunca respondeu',
                          'enrollment_id', b.enrollment_id)
FROM public._bkp_limbo_recovery_matheus_20261022 b
JOIN leads l ON l.id = b.lead_id;

COMMIT;

-- Reversão:
-- UPDATE cadence_enrollments ce SET status = b.enr_status, completed_at = b.completed_at, loss_reason_id = b.enr_loss_reason_id
--   FROM public._bkp_limbo_recovery_matheus_20261022 b WHERE ce.id = b.enrollment_id;
-- UPDATE leads l SET status = b.lead_status, lost_at = b.lost_at, loss_reason_id = b.loss_reason_id
--   FROM public._bkp_limbo_recovery_matheus_20261022 b WHERE l.id = b.lead_id;
-- Dropar o backup após 21/nov/2026.
