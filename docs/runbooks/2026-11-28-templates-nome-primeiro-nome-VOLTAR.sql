-- Volta os 17 modelos de WhatsApp (Inbound v2 + Recovery, org V4) de {{primeiro_nome}} para [Nome].
-- Aplicado em 28/11/2026. Antes da troca nenhum desses modelos tinha {{primeiro_nome}},
-- então a volta é a troca inversa exata.
BEGIN;
UPDATE message_templates
SET body = replace(body, '{{primeiro_nome}}', '[Nome]')
WHERE org_id = 'c2727473-1df8-4faa-9264-a9fc1759fe3b'
  AND id IN (
    '15bae4c5-93c7-4030-a792-58a1e902a1aa','ab83611d-9ab2-40e9-8daa-3116ef278a9f',
    'ee06963b-e79a-4524-9521-76bc4ccd89d7','e204961b-7bb0-4e62-8af2-f6d1e3818e1f',
    '88420b18-9247-4e53-a8c6-62b799a99d38','81db045f-8214-4174-88af-e08979ebe5cb',
    'c241b3a8-f30a-4371-87fb-13c7651d9511','082d4312-7042-4981-a3c7-2f2f8e6652fe',
    '25ffd5f8-21e8-4426-9baf-2308c2ff9532','e9d1e6d2-2f51-4b1e-87e0-0cbed7919f50',
    '68553065-6326-4f6a-ac81-0dbc28290023','85e8e75b-5b60-4afa-92d7-30a0659a32d5',
    'f6aaaf13-051c-497b-8f57-9ecd223b721f','2873dc50-c619-4e00-8e70-88186c561b93',
    '1a84f4d6-37d0-484f-830f-69e266c7b46b','f3fc6535-c476-4372-873d-25b8fae9dc61',
    '6cd16fe4-789a-4140-b36a-28f613656631'
  );
COMMIT;
