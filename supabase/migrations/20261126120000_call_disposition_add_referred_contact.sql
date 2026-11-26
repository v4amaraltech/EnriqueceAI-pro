-- Adiciona o desfecho "Indicou outro contato" ao enum call_disposition (calls.sdr_disposition).
--
-- A pessoa atendeu e indicou quem é o contato certo. Houve conversa e há uma ação a tomar:
-- no código vale como "Pediu para ligar depois". Por ora só o motor do Cockpit usa o valor
-- (não entra nos seletores de Atividades, Power Dialer e Ligação via WhatsApp).
--
-- Idempotente e forward-only. SEM BEGIN/COMMIT de propósito (igual a
-- 20260803160000_call_disposition_add_voicemail.sql). Aplicar ANTES do deploy do código que
-- referencia o valor e antes de 20261126120100_cockpit_recovery_candidates_referred_contact.sql.

ALTER TYPE public.call_disposition ADD VALUE IF NOT EXISTS 'referred_contact';
