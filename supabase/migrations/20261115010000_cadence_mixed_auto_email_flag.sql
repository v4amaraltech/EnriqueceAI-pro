BEGIN;

-- E-mail automático em cadência standard (mista). Nasce desligada para todo
-- mundo. A única org na lista é a V4 Company Amaral. Não marca enabled = true
-- (isso ligaria todas as orgs). Não aplica sozinha em produção: é só a linha
-- da flag.

INSERT INTO public.app_flags (key, enabled, note, allow_org_ids, allow_user_ids)
VALUES (
  'cadence_mixed_auto_email_v1',
  false,
  'Envio automático de e-mail em cadência standard (mista), pelo execute-cadence-steps. Desligada: o e-mail da cadência mista continua sendo tarefa do SDR. Para ligar uma org, acrescente o uuid em allow_org_ids. Não marque enabled = true (ligaria todas).',
  ARRAY['c2727473-1df8-4faa-9264-a9fc1759fe3b']::uuid[],
  '{}'
)
ON CONFLICT (key) DO NOTHING;

COMMIT;
