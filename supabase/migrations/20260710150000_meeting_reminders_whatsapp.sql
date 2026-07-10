-- Meeting reminder follow-up — F2: suporte a WhatsApp na view.
-- Telefone/opt-in vem de calls.destination da ligação CONECTADA mais recente
-- (opt-in = houve conversa prévia naquele número). leads.phones está vazio
-- para os leads com reunião, por isso a fonte é calls.
--
-- A ATIVAÇÃO dos passos WhatsApp (canal/sequência) é decisão de produto + LGPD e
-- fica fora desta migração — aqui só habilitamos o canal com segurança. Enquanto
-- não houver reminder_steps com channel='whatsapp' ativos, a view não devolve
-- nenhuma linha whatsapp. Forward-only, idempotente.

-- 1. Normalização de telefone BR (tira DDI/tronco, prefixa 55) ---------------
-- Espelha validateBrazilianPhone + strip do "0" de tronco (011... -> 5511...).
CREATE OR REPLACE FUNCTION public.normalize_br_phone(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  WITH d AS (
    SELECT regexp_replace(regexp_replace(coalesce(raw, ''), '\D', '', 'g'), '^0+', '') AS digits
  )
  SELECT CASE
    WHEN length(digits) IN (10, 11) THEN '55' || digits
    WHEN length(digits) IN (12, 13) AND digits LIKE '55%' THEN digits
    ELSE NULL
  END
  FROM d;
$$;

-- 2. View com whatsapp_phone + gate de canal --------------------------------
CREATE OR REPLACE VIEW public.v_reminders_due
WITH (security_invoker = true) AS
SELECT * FROM (
  SELECT
    l.org_id,
    l.id                 AS lead_id,
    l.assigned_to        AS sdr_user_id,
    l.first_name,
    l.last_name,
    l.razao_social,
    l.nome_fantasia,
    l.email,
    l.meeting_scheduled_at,
    l.meeting_starts_at,
    mi.meet_link,
    mi.calendar_event_id,
    rs.id                AS reminder_step_id,
    rs.context,
    rs.step_order,
    rs.channel,
    rs.message_template_id,
    CASE rs.anchor
      WHEN 'on_book' THEN l.meeting_scheduled_at + make_interval(mins => rs.offset_minutes)
      ELSE                l.meeting_starts_at    + make_interval(mins => rs.offset_minutes)
    END AS fire_at,
    wa.whatsapp_phone
  FROM public.leads l
  JOIN public.reminder_source_context m
    ON m.org_id = l.org_id AND m.lead_source = l.lead_source
  JOIN public.reminder_steps rs
    ON rs.org_id = l.org_id AND rs.context = m.context AND rs.active
  LEFT JOIN LATERAL (
    SELECT i.metadata->>'meet_link'         AS meet_link,
           i.metadata->>'calendar_event_id' AS calendar_event_id
    FROM public.interactions i
    WHERE i.lead_id = l.id AND i.type = 'meeting_scheduled'
    ORDER BY i.created_at DESC
    LIMIT 1
  ) mi ON true
  LEFT JOIN LATERAL (
    SELECT public.normalize_br_phone(c.destination) AS whatsapp_phone
    FROM public.calls c
    WHERE c.lead_id = l.id
      AND c.connected
      AND public.normalize_br_phone(c.destination) IS NOT NULL
    ORDER BY c.started_at DESC NULLS LAST
    LIMIT 1
  ) wa ON true
  WHERE l.meeting_starts_at IS NOT NULL
    AND l.meeting_starts_at > now()
    AND l.meeting_held_at IS NULL
    AND l.deleted_at IS NULL
    AND l.status NOT IN ('archived','unqualified','won')
    AND l.assigned_to IS NOT NULL
    AND (
      (rs.channel = 'email'
        AND l.email IS NOT NULL
        AND l.email_bounced_at IS NULL)
      OR
      (rs.channel = 'whatsapp'
        AND wa.whatsapp_phone IS NOT NULL
        AND l.whatsapp_invalid_at IS NULL)
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.meeting_reminder_log lg
      WHERE lg.lead_id = l.id
        AND lg.reminder_step_id = rs.id
        AND lg.meeting_starts_at = l.meeting_starts_at
    )
) x
WHERE x.fire_at <= now();

-- 3. Templates WhatsApp (DRAFT, texto puro) — não ligados a passos ainda.
-- Ativação (linkar + criar/ativar reminder_steps whatsapp) é decisão de produto.
INSERT INTO public.message_templates (org_id, name, channel, subject, body, variables_used, is_system, created_by)
SELECT v.org_id::uuid, v.name, 'whatsapp'::channel_type, NULL, v.body, v.vars, false, NULL
FROM (VALUES
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião WA — Confirmação',
   E'Oi {{primeiro_nome}}, aqui é {{nome_vendedor}} da V4! ✅\n\nSua reunião está confirmada para {{data_reuniao}} às {{hora_reuniao}} (horário de Brasília).\n{{link_reuniao_linha}}\nQualquer imprevisto, é só me chamar por aqui. Até lá! 🚀',
   ARRAY['primeiro_nome','nome_vendedor','data_reuniao','hora_reuniao','link_reuniao_linha']),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião WA — Reconfirmação 24h',
   E'Oi {{primeiro_nome}}, tudo certo? 😊\n\nÉ amanhã nossa reunião: {{data_reuniao}} às {{hora_reuniao}} (horário de Brasília).\n{{link_reuniao_linha}}\nContinua de pé pra você? Se precisar ajustar, me avisa por aqui.',
   ARRAY['primeiro_nome','data_reuniao','hora_reuniao','link_reuniao_linha']),
  ('c2727473-1df8-4faa-9264-a9fc1759fe3b',
   'Lembrete Reunião WA — Lembrete final',
   E'Oi {{primeiro_nome}}! Nossa reunião é daqui a pouco, às {{hora_reuniao}} (horário de Brasília).\n{{link_reuniao_linha}}\nJá deixo o acesso aqui pra facilitar. Até já! 👋',
   ARRAY['primeiro_nome','hora_reuniao','link_reuniao_linha'])
) AS v(org_id, name, body, vars)
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_templates mt
  WHERE mt.org_id = v.org_id::uuid AND mt.name = v.name
);
