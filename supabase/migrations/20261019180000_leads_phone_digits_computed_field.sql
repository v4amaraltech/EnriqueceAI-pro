-- Busca de lead por telefone na tela /leads.
--
-- O telefone é texto livre: '5516999867577', '+55 16 99986-7577', '(16) 99986-7577',
-- '16 999867577'... Um ilike direto em `telefone` só acha o lead se o SDR digitar
-- exatamente com a mesma formatação. Esta função vira uma "computed field" do
-- PostgREST (função que recebe a linha de `leads`): a app filtra com
-- `phone_digits.ilike.%<dígitos>%` e o banco compara só os dígitos.
--
-- Cobre: `telefone`, cada número do JSONB `phones` e os telefones de todos os
-- contatos em `lead_contacts` (não só o primário, que já é espelhado no lead).
-- Os números ficam separados por espaço para um trecho digitado não "emendar"
-- dois números diferentes.
--
-- SECURITY INVOKER: roda com o usuário logado, então a RLS de `leads` e
-- `lead_contacts` continua valendo.

BEGIN;

CREATE OR REPLACE FUNCTION public.phone_digits(public.leads)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_catalog
AS $$
  SELECT concat_ws(' ',
    nullif(regexp_replace(coalesce($1.telefone, ''), '[^0-9]', '', 'g'), ''),
    (
      SELECT string_agg(nullif(regexp_replace(
        coalesce(p->>'numero', CASE WHEN jsonb_typeof(p) = 'string' THEN p #>> '{}' END, ''),
        '[^0-9]', '', 'g'), ''), ' ')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof($1.phones) = 'array' THEN $1.phones ELSE '[]'::jsonb END) p
    ),
    (
      SELECT string_agg(nullif(regexp_replace(
        coalesce(p->>'numero', CASE WHEN jsonb_typeof(p) = 'string' THEN p #>> '{}' END, ''),
        '[^0-9]', '', 'g'), ''), ' ')
      FROM public.lead_contacts c
      CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c.phones) = 'array' THEN c.phones ELSE '[]'::jsonb END) p
      WHERE c.lead_id = $1.id
    )
  );
$$;

COMMENT ON FUNCTION public.phone_digits(public.leads) IS
  'Computed field (PostgREST): todos os telefones do lead só com dígitos, separados por espaço. Usada na busca da tela /leads.';

REVOKE ALL ON FUNCTION public.phone_digits(public.leads) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.phone_digits(public.leads) FROM anon;
GRANT EXECUTE ON FUNCTION public.phone_digits(public.leads) TO authenticated, service_role;

COMMIT;
