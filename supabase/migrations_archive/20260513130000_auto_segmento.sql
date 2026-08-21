-- Auto-fill `segmento` in two layers:
--   1. CNAE prefix → segmento (precise, 239 V4 Amaral leads have a CNAE)
--   2. Heuristic keywords in razao_social / nome_fantasia (approximate,
--      covers a chunk of the 1811 leads with no CNAE)
--
-- Trigger applies CNAE first, falls back to heuristic. Never-overwrite
-- behavior: only fires when segmento is NULL/empty.

BEGIN;

-- Layer 1: CNAE → segmento. Uses the 2-digit prefix (IBGE divisão).
CREATE OR REPLACE FUNCTION public.derive_segmento_from_cnae(cnae_input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_digits TEXT;
  v_prefix INT;
BEGIN
  IF cnae_input IS NULL OR trim(cnae_input) = '' THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(cnae_input, '\D', '', 'g');
  IF length(v_digits) < 2 THEN
    RETURN NULL;
  END IF;

  v_prefix := substring(v_digits from 1 for 2)::INT;

  RETURN CASE
    WHEN v_prefix BETWEEN  1 AND  3 THEN 'Agronegócio'
    WHEN v_prefix BETWEEN  5 AND  9 THEN 'Indústria Extrativa'
    WHEN v_prefix BETWEEN 10 AND 33 THEN 'Indústria'
    WHEN v_prefix = 35              THEN 'Energia'
    WHEN v_prefix BETWEEN 36 AND 39 THEN 'Saneamento / Meio Ambiente'
    WHEN v_prefix BETWEEN 41 AND 43 THEN 'Construção'
    WHEN v_prefix BETWEEN 45 AND 47 THEN 'Varejo / Comércio'
    WHEN v_prefix BETWEEN 49 AND 53 THEN 'Transporte / Logística'
    WHEN v_prefix BETWEEN 55 AND 56 THEN 'Alimentação / Hotelaria'
    WHEN v_prefix BETWEEN 58 AND 63 THEN 'Tecnologia / Mídia'
    WHEN v_prefix BETWEEN 64 AND 66 THEN 'Financeiro'
    WHEN v_prefix = 68              THEN 'Imobiliário'
    WHEN v_prefix BETWEEN 69 AND 75 THEN 'Serviços Profissionais'
    WHEN v_prefix BETWEEN 77 AND 82 THEN 'Serviços Administrativos'
    WHEN v_prefix = 84              THEN 'Administração Pública'
    WHEN v_prefix = 85              THEN 'Educação'
    WHEN v_prefix BETWEEN 86 AND 88 THEN 'Saúde'
    WHEN v_prefix BETWEEN 90 AND 93 THEN 'Cultura / Esporte'
    WHEN v_prefix BETWEEN 94 AND 96 THEN 'Outros Serviços'
    WHEN v_prefix = 97              THEN 'Serviços Domésticos'
    ELSE NULL
  END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_segmento_from_cnae(TEXT) FROM anon, authenticated, PUBLIC;

-- Layer 2: heuristic by name. Cheaper and approximate.
-- Order matters — more specific patterns first so they don't get hijacked
-- by broader ones (e.g. "saude mental" before generic "med").
CREATE OR REPLACE FUNCTION public.derive_segmento_from_nome(razao TEXT, fantasia TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_text TEXT;
BEGIN
  v_text := lower(coalesce(fantasia, '') || ' ' || coalesce(razao, ''));
  IF trim(v_text) = '' THEN RETURN NULL; END IF;

  IF v_text ~ '(funera|memorial|cemiteri|crematori)' THEN RETURN 'Serviços Funerários'; END IF;
  IF v_text ~ '(clinic|hospital|odonto|enfermag|saude|fisioterap)' THEN RETURN 'Saúde'; END IF;
  IF v_text ~ '(petshop|pet shop|veterinar)' THEN RETURN 'Pet'; END IF;
  IF v_text ~ '(academia|fitness|crossfit|musculacao)' THEN RETURN 'Fitness / Esporte'; END IF;
  IF v_text ~ '(escola|colegio|universidade|faculdade|ensino|curso )' THEN RETURN 'Educação'; END IF;
  IF v_text ~ '(\msoft|tecnologia|sistema|softw|developer|software|ti ltda)' THEN RETURN 'Tecnologia / Software'; END IF;
  IF v_text ~ '(construc|engenharia|empreit|construt|incorporad)' THEN RETURN 'Construção'; END IF;
  IF v_text ~ '(transport|logistic|frota|fretes|express|mudanc)' THEN RETURN 'Transporte / Logística'; END IF;
  IF v_text ~ '(restaurant|lanchonete|cafeteria|alimenta|padaria|confeitaria|pizzaria)' THEN RETURN 'Alimentação'; END IF;
  IF v_text ~ '(hotel|pousada|hostel|resort)' THEN RETURN 'Hotelaria'; END IF;
  IF v_text ~ '(imobil|imovei|empreendimento)' THEN RETURN 'Imobiliário'; END IF;
  IF v_text ~ '(marketing|agencia|publicid|propagand|midia)' THEN RETURN 'Marketing / Publicidade'; END IF;
  IF v_text ~ '(agropec|agricol|fazenda|pecuari|laticini)' THEN RETURN 'Agronegócio'; END IF;
  IF v_text ~ '(\mbanc|financeir|invest|seguros|corretor de)' THEN RETURN 'Financeiro'; END IF;
  IF v_text ~ '(advocac|advogad|escritorio juridic)' THEN RETURN 'Jurídico'; END IF;
  IF v_text ~ '(consult|assessor)' THEN RETURN 'Consultoria'; END IF;
  IF v_text ~ '(beleza|salao|estetic|barbearia|cabelos|cosmetic)' THEN RETURN 'Beleza / Estética'; END IF;
  IF v_text ~ '(automotiv|veiculo|oficina mec|mecanic|autopec|locadora)' THEN RETURN 'Automotivo'; END IF;
  IF v_text ~ '(industr|fabric|metalu|usinagem)' THEN RETURN 'Indústria'; END IF;
  IF v_text ~ '(varejo|atacad|comerci|loja\M)' THEN RETURN 'Varejo / Comércio'; END IF;

  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_segmento_from_nome(TEXT, TEXT) FROM anon, authenticated, PUBLIC;

-- Master: CNAE wins when present; otherwise fall back to name heuristic.
CREATE OR REPLACE FUNCTION public.derive_segmento(cnae TEXT, razao TEXT, fantasia TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = 'public', 'pg_catalog'
AS $$
DECLARE
  v_cnae_seg TEXT;
BEGIN
  IF cnae IS NOT NULL AND trim(cnae) <> '' THEN
    v_cnae_seg := derive_segmento_from_cnae(cnae);
    IF v_cnae_seg IS NOT NULL THEN
      RETURN v_cnae_seg;
    END IF;
  END IF;
  RETURN derive_segmento_from_nome(razao, fantasia);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.derive_segmento(TEXT, TEXT, TEXT) FROM anon, authenticated, PUBLIC;

CREATE OR REPLACE FUNCTION public.auto_fill_segmento()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = 'public', 'pg_catalog'
AS $$
BEGIN
  IF NEW.segmento IS NULL OR NEW.segmento = '' THEN
    NEW.segmento := derive_segmento(NEW.cnae, NEW.razao_social, NEW.nome_fantasia);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auto_fill_segmento_trigger ON leads;

CREATE TRIGGER auto_fill_segmento_trigger
  BEFORE INSERT OR UPDATE OF cnae, razao_social, nome_fantasia, segmento ON leads
  FOR EACH ROW
  EXECUTE FUNCTION auto_fill_segmento();

UPDATE leads
SET segmento = derive_segmento(cnae, razao_social, nome_fantasia)
WHERE deleted_at IS NULL
  AND (segmento IS NULL OR segmento = '')
  AND derive_segmento(cnae, razao_social, nome_fantasia) IS NOT NULL;

COMMIT;
