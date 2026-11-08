-- Correções de segurança LOW da auditoria (pistas 25, 26 e achado X1).
-- Idempotente, forward-only. Não aplicar sem revisão.
--
-- Pista 25: policies de message_templates, loss_reasons e reminder_steps só checavam org_id,
--   então um SDR editava template do gerente (inclusive is_system) e mexia em motivos de perda.
--   Alinhadas ao que as actions já exigem (templates: gerente ou criador; loss_reasons e
--   reminder_steps: gerente para escrever). calendar_slots fica de fora: o fluxo de agenda
--   do BDR grava com a sessão do usuário.
-- Pista 26: org-logos aceitava escrita de qualquer membro e sem limite de tipo/tamanho.
-- X1: sobrecarga get_calls_for_v4sales(text) (SECURITY DEFINER, anon executável) sem chamadores.

BEGIN;

-- 1. Pista 25: message_templates -------------------------------------------------
DROP POLICY IF EXISTS "templates_org_insert" ON public.message_templates;
CREATE POLICY "templates_org_insert" ON public.message_templates FOR INSERT
  WITH CHECK (
    org_id = (SELECT public.user_org_id())
    AND (
      (SELECT public.is_manager())
      OR (is_system = false AND created_by = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "templates_org_update" ON public.message_templates;
CREATE POLICY "templates_org_update" ON public.message_templates FOR UPDATE
  USING (
    org_id = (SELECT public.user_org_id())
    AND (
      (SELECT public.is_manager())
      OR (is_system = false AND created_by = (SELECT auth.uid()))
    )
  )
  WITH CHECK (
    org_id = (SELECT public.user_org_id())
    AND (
      (SELECT public.is_manager())
      OR (is_system = false AND created_by = (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "templates_org_delete" ON public.message_templates;
CREATE POLICY "templates_org_delete" ON public.message_templates FOR DELETE
  USING (
    org_id = (SELECT public.user_org_id())
    AND is_system = false
    AND (
      (SELECT public.is_manager())
      OR created_by = (SELECT auth.uid())
    )
  );

-- 2. Pista 25: loss_reasons (escrita só gerente) -----------------------------------
DROP POLICY IF EXISTS "loss_reasons_insert_own_org" ON public.loss_reasons;
CREATE POLICY "loss_reasons_insert_own_org" ON public.loss_reasons FOR INSERT
  WITH CHECK (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

DROP POLICY IF EXISTS "loss_reasons_update_own_org" ON public.loss_reasons;
CREATE POLICY "loss_reasons_update_own_org" ON public.loss_reasons FOR UPDATE
  USING (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()))
  WITH CHECK (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

DROP POLICY IF EXISTS "loss_reasons_delete_own_org" ON public.loss_reasons;
CREATE POLICY "loss_reasons_delete_own_org" ON public.loss_reasons FOR DELETE
  USING (
    org_id = (SELECT public.user_org_id())
    AND is_system = false
    AND (SELECT public.is_manager())
  );

-- 3. Pista 25: reminder_steps (leitura da org, escrita só gerente) -----------------
DROP POLICY IF EXISTS rs_org ON public.reminder_steps;
DROP POLICY IF EXISTS rs_org_select ON public.reminder_steps;
DROP POLICY IF EXISTS rs_org_write ON public.reminder_steps;
CREATE POLICY rs_org_select ON public.reminder_steps FOR SELECT
  USING (org_id = (SELECT public.user_org_id()));
CREATE POLICY rs_org_write ON public.reminder_steps FOR ALL
  USING (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()))
  WITH CHECK (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

-- 4. Pista 26: org-logos (escrita só gerente + limites do bucket) -------------------
DROP POLICY IF EXISTS "Org members can upload logo" ON storage.objects;
CREATE POLICY "Org members can upload logo" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (SELECT public.user_org_id())::text
    AND (SELECT public.is_manager())
  );

DROP POLICY IF EXISTS "Org members can update logo" ON storage.objects;
CREATE POLICY "Org members can update logo" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (SELECT public.user_org_id())::text
    AND (SELECT public.is_manager())
  )
  WITH CHECK (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (SELECT public.user_org_id())::text
    AND (SELECT public.is_manager())
  );

DROP POLICY IF EXISTS "Org members can delete logo" ON storage.objects;
CREATE POLICY "Org members can delete logo" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'org-logos'
    AND (storage.foldername(name))[1] = (SELECT public.user_org_id())::text
    AND (SELECT public.is_manager())
  );

UPDATE storage.buckets
SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'],
    file_size_limit = 5242880
WHERE id = 'org-logos';

-- 5. X1: sobrecarga de 1 argumento sem chamadores e exposta a anon -------------------
DROP FUNCTION IF EXISTS public.get_calls_for_v4sales(text);

COMMIT;

NOTIFY pgrst, 'reload schema';
