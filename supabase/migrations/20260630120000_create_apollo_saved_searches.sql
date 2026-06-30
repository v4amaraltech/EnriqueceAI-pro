BEGIN;

-- Filtros salvos da busca do Apollo (presets nomeados), por usuário por org.
-- `filters` guarda o estado do formulário de busca (ApolloFilterState).
CREATE TABLE IF NOT EXISTS apollo_saved_searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Salvar com um nome já existente sobrescreve (upsert por este conflito).
  UNIQUE (org_id, user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_apollo_saved_searches_owner
  ON apollo_saved_searches (org_id, user_id);

ALTER TABLE apollo_saved_searches ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at ON apollo_saved_searches;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON apollo_saved_searches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Cada usuário só enxerga/gerencia os próprios filtros (owner-scoped por org).
DROP POLICY IF EXISTS "apollo_saved_searches_select" ON apollo_saved_searches;
CREATE POLICY "apollo_saved_searches_select" ON apollo_saved_searches
  FOR SELECT USING (org_id = public.user_org_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "apollo_saved_searches_insert" ON apollo_saved_searches;
CREATE POLICY "apollo_saved_searches_insert" ON apollo_saved_searches
  FOR INSERT WITH CHECK (org_id = public.user_org_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "apollo_saved_searches_update" ON apollo_saved_searches;
CREATE POLICY "apollo_saved_searches_update" ON apollo_saved_searches
  FOR UPDATE USING (org_id = public.user_org_id() AND user_id = auth.uid());

DROP POLICY IF EXISTS "apollo_saved_searches_delete" ON apollo_saved_searches;
CREATE POLICY "apollo_saved_searches_delete" ON apollo_saved_searches
  FOR DELETE USING (org_id = public.user_org_id() AND user_id = auth.uid());

COMMIT;
