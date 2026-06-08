-- Data backfill (registro versionado de intervenção aplicada em produção em
-- 2026-06-08): cria a atividade de follow-up (telefone) para leads que foram
-- REABERTOS por feedback no_show/rescheduled do closer mas ficaram parados em
-- 'qualified' SEM nenhum follow-up — auditoria de jun/2026 mostrou que ~1/3
-- dos leads reabertos esfriavam, pois a reabertura só notificava (passivo).
--
-- Espelha a automação introduzida em src/app/api/feedback/route.ts
-- (scheduleReopenFollowUp), que passou a criar essa atividade automaticamente
-- nas reaberturas dali pra frente. Esta migration recupera o histórico.
--
-- IDEMPOTENTE: o guard "NOT EXISTS pending activity" impede duplicação se a
-- migration for reaplicada (após o 1º backfill os leads já têm atividade
-- pendente). Em ambientes sem os dados de produção (local/CI via db reset) é
-- um no-op. Forward-only. NÃO recria as notifications in-app do backfill —
-- avisos transientes já entregues, fora do escopo de versionamento de dados.

BEGIN;

WITH reopened AS (
  SELECT DISTINCT ON (l.id)
    l.id AS lead_id, l.org_id, cfr.responded_at,
    COALESCE(l.won_by, l.assigned_to) AS sdr
  FROM closer_feedback_requests cfr
  JOIN leads l ON l.id = cfr.lead_id
  WHERE cfr.result IN ('no_show', 'rescheduled')
    AND cfr.responded_at IS NOT NULL
    AND l.deleted_at IS NULL
    AND l.status = 'qualified'
  ORDER BY l.id, cfr.responded_at DESC
),
targets AS (
  SELECT r.lead_id, r.org_id, r.sdr
  FROM reopened r
  WHERE r.sdr IS NOT NULL
    -- sem nenhum toque humano após a reabertura (lead realmente abandonado)
    AND NOT EXISTS (
      SELECT 1 FROM interactions i
      WHERE i.lead_id = r.lead_id
        AND i.created_at > r.responded_at
        AND i.type IN ('sent', 'delivered')
        AND i.channel IN ('phone', 'whatsapp', 'email', 'linkedin')
    )
    -- guard anti-duplicata: não empilha se já há atividade pendente
    AND NOT EXISTS (
      SELECT 1 FROM scheduled_activities sa
      WHERE sa.lead_id = r.lead_id AND sa.status = 'pending'
    )
),
ins_act AS (
  INSERT INTO scheduled_activities (org_id, lead_id, user_id, channel, scheduled_at, status, notes)
  SELECT
    org_id, lead_id, sdr, 'phone'::channel_type,
    -- agendado no backfill original para o próximo dia útil (terça 09/06) 9h BRT
    timestamptz '2026-06-09 12:00:00+00',
    'pending',
    'Reaberto: closer marcou não compareceu — retomar contato'
  FROM targets
  RETURNING lead_id, org_id
)
INSERT INTO interactions (org_id, lead_id, channel, type, message_content, metadata)
SELECT
  org_id, lead_id, 'system', 'sent',
  'Atividade de retorno agendada automaticamente (telefone) — lead reaberto',
  jsonb_build_object(
    'system_event', 'activity_scheduled',
    'auto', true,
    'source', 'closer_feedback_reopen_backfill'
  )
FROM ins_act;

COMMIT;
