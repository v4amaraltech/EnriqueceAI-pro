BEGIN;

-- NOTA DE RECONCILIAÇÃO (2026-05-30): esta migration foi aplicada diretamente
-- em produção em 2026-05-27 (hotfix de advisor) e trazida ao repositório
-- retroativamente para sincronizar o histórico versionado. Conteúdo idêntico
-- ao registrado em supabase_migrations.schema_migrations.

-- Revoga acesso anon à função get_calls_for_v4sales(text, integer).
-- Esta função não possui verificação de token e expõe dados sensíveis
-- (transcrições, URLs de gravação, destinos) sem qualquer autenticação.
REVOKE EXECUTE ON FUNCTION public.get_calls_for_v4sales(text, integer) FROM anon;

COMMIT;
