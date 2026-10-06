-- Destrava 12 cadências do Guilherme paradas num passo já feito (story executed-step-scoped-to-enrollment).
-- Backup já criado: public._bkp_executed_step_recovery_20261006 (12 linhas, RLS + REVOKE).
-- Rodar no SQL Editor do Supabase (projeto dhkmonctyoaenejemkrt). Só altera se o passo atual ainda for o esperado.
WITH alvo(id, de, para) AS (VALUES
 ('4cd57940-6b97-4974-b30a-96c52d9161c0'::uuid,1,4),('b88f30dc-3101-45bf-8e11-1e311d4610f8'::uuid,1,4),
 ('c6bca16a-9c65-444f-adce-ecf3c2808431'::uuid,1,4),('4ad7d55c-cc2a-499a-b40e-1e4ad2bc73c4'::uuid,1,4),
 ('3d87e7df-9bad-413e-afd3-d193bdd7018d'::uuid,1,4),('06e5105c-fc29-4a9c-acea-6bc4457c6da8'::uuid,1,4),
 ('d3fadcce-5c3b-42aa-ba60-43ea7815e46f'::uuid,1,5),('1f3867fd-b8d9-4e60-bb4e-6fba3ff99682'::uuid,1,5),
 ('94581d07-9850-4be2-b499-28427a5c91e4'::uuid,1,6),('26534805-a7d8-4840-999a-83031ab746d0'::uuid,1,5),
 ('21aa7f7b-78cf-4c04-9498-71c76947e937'::uuid,3,7),('4a84c809-7112-4cc9-9470-6bd100e69ee5'::uuid,5,7)),
upd AS (
 UPDATE cadence_enrollments ce SET current_step = a.para, snooze_count = 0
 FROM alvo a WHERE ce.id = a.id AND ce.current_step = a.de AND ce.status = 'active'
 RETURNING ce.id, ce.org_id, ce.lead_id, ce.cadence_id, a.de, a.para, ce.next_step_due),
nota AS (
 INSERT INTO interactions (org_id, lead_id, cadence_id, step_id, channel, type, message_content, performed_by, metadata)
 SELECT org_id, lead_id, cadence_id, NULL, 'system', 'sent',
   'Cadência destravada: passo ' || de || ' já tinha sido feito; seguiu para o passo ' || para || '.', NULL,
   jsonb_build_object('system_event','enrollment_unstuck','enrollment_id',id,'from_step',de,'to_step',para,'backup','_bkp_executed_step_recovery_20261006')
 FROM upd RETURNING 1)
SELECT u.id, u.de, u.para, u.next_step_due AT TIME ZONE 'America/Sao_Paulo' AS novo_vencimento FROM upd u;
-- Esperado: 12 linhas.
