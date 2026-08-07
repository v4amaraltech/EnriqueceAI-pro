BEGIN;

-- NOTA DE RECONCILIAÇÃO (2026-05-30): esta migration foi aplicada diretamente
-- em produção em 2026-05-27 (hotfix de advisor) e trazida ao repositório
-- retroativamente para sincronizar o histórico versionado. Conteúdo idêntico
-- ao registrado em supabase_migrations.schema_migrations.

-- O REVOKE anterior removeu anon explicitamente, mas a role herda EXECUTE via PUBLIC (=X).
-- Revoga de PUBLIC para eliminar o acesso anon de vez.
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(text, integer) FROM PUBLIC;

COMMIT;
