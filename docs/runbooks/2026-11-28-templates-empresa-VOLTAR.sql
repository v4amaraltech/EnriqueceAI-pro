-- Volta os 4 modelos de WhatsApp (org V4) de {{empresa}} para [Empresa].
-- Aplicado em 28/11/2026. Antes da troca nenhum deles tinha {{empresa}}, então a volta é a troca inversa exata.
BEGIN;
UPDATE message_templates
SET body = replace(body, '{{empresa}}', '[Empresa]')
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND id IN (
    '15bae4c5-93c7-4030-a792-58a1e902a1aa', -- Inbound v2 — Dia 1 — Abertura
    'e9d1e6d2-2f51-4b1e-87e0-0cbed7919f50', -- Recovery — Dia 10 — Breakup final
    '68553065-6326-4f6a-ac81-0dbc28290023', -- Recovery — Dia 2 — Case por nicho
    '1a84f4d6-37d0-484f-830f-69e266c7b46b'  -- Recovery — Dia 6 — Novo escopo
  );
COMMIT;
