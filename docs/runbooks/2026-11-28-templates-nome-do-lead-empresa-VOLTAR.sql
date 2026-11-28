-- Volta 3 modelos de WhatsApp Recovery (org V4): {{primeiro_nome}} -> [Nome do Lead] e {{empresa}} -> [Nome da Empresa].
-- Aplicado em 28/11/2026. Antes da troca nenhum deles tinha {{empresa}}; Dia 1 (A/B) não tinham {{primeiro_nome}}.
-- O Dia 9 já tinha {{primeiro_nome}} vindo de [Nome] (ver 2026-11-28-templates-nome-primeiro-nome-VOLTAR.sql),
-- por isso nele só o {{empresa}} volta.
BEGIN;
UPDATE message_templates
SET body = replace(replace(body, '{{primeiro_nome}}', '[Nome do Lead]'), '{{empresa}}', '[Nome da Empresa]')
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND id IN (
    '9cd4304b-2bce-4300-9fb7-ed1602b3e4a5', -- Recovery — Dia 1 — Abertura (A)
    'bba0d3a2-bdb0-474a-a7bf-097e73313ae5'  -- Recovery — Dia 1 — Abertura (B)
  );
UPDATE message_templates
SET body = replace(body, '{{empresa}}', '[Nome da Empresa]')
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND id = '6cd16fe4-789a-4140-b36a-28f613656631'; -- Recovery — Dia 9 — Case breakup suave
COMMIT;
