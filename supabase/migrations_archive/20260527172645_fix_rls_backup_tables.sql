BEGIN;

-- NOTA DE RECONCILIAÇÃO (2026-05-30): esta migration foi aplicada diretamente
-- em produção em 2026-05-27 (hotfix de advisor) e trazida ao repositório
-- retroativamente para sincronizar o histórico versionado. Conteúdo idêntico
-- ao registrado em supabase_migrations.schema_migrations.

-- Habilita RLS nas tabelas de backup expostas ao PostgREST.
-- Sem políticas definidas, todo acesso via API é bloqueado por padrão.
-- service_role continua com acesso irrestrito (bypassa RLS).
ALTER TABLE public.calls_dedupe_backup_20260517 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls_ghost_backup_20260517 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls_refined_backup_20260517 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls_guilherme_extra_backup_20260517 ENABLE ROW LEVEL SECURITY;

COMMIT;
