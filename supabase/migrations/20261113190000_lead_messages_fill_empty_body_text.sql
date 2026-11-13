BEGIN;

-- Folga estreita no append-only de lead_messages para preencher body_text vazio.
--
-- NÃO aplicar neste PR. Aplicar só depois da revisão, e só então rodar o script
-- scripts/fill-lead-messages-body-text.ts com --apply.
--
-- Por quê: em 13/11/2026 os e-mails de saída da cadência na V4 entraram em
-- lead_messages com body_html e body_text nulo (o escritor só mandava o HTML).
-- O código novo grava o texto. As linhas antigas só se corrigem com UPDATE de
-- body_text, e o trigger recusava qualquer mudança no corpo.
--
-- Regra nova:
--   DELETE continua recusado.
--   Mudar body_html continua recusado.
--   Reescrever ou apagar um body_text que já tem conteúdo continua recusado.
--   UPDATE de body_text só passa quando o valor antigo é nulo ou só espaço,
--   o novo tem texto e body_html não muda.

CREATE OR REPLACE FUNCTION public.reject_lead_message_body_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'lead_messages body is append-only';
  END IF;
  IF NEW.body_html IS DISTINCT FROM OLD.body_html THEN
    RAISE EXCEPTION 'lead_messages body is append-only';
  END IF;
  IF NEW.body_text IS DISTINCT FROM OLD.body_text THEN
    IF NOT (
      (OLD.body_text IS NULL OR OLD.body_text !~ '\S')
      AND NEW.body_text IS NOT NULL
      AND NEW.body_text ~ '\S'
    ) THEN
      RAISE EXCEPTION 'lead_messages body is append-only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- O script roda com service_role, que só tinha SELECT e INSERT.
-- Libera UPDATE apenas da coluna body_text. O trigger acima limita o que passa.
GRANT UPDATE (body_text) ON public.lead_messages TO service_role;

COMMIT;
