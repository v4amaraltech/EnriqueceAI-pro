-- Perfis de usuário (e-mail, nome, avatar) em UMA consulta.
--
-- Por quê: organization_members não guarda nome/e-mail — eles vivem em
-- auth.users. A aplicação resolvia isso chamando auth.admin.getUserById uma vez
-- por usuário (listUsers falha neste projeto), em ~20 lugares — inclusive no
-- layout autenticado, que roda a cada navegação. Em 02/10 (sexta) foram ~5.600
-- chamadas a /auth/v1/admin/users/:id, ~155 ms cada.
--
-- Só service_role executa (mesmo poder do auth.admin.getUserById que substitui).
-- SECURITY DEFINER com search_path vazio; criada com CREATE OR REPLACE (nunca
-- DROP + CREATE, que reconcede EXECUTE a PUBLIC).

BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_profiles(p_user_ids uuid[])
RETURNS TABLE (id uuid, email text, full_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    u.id,
    u.email::text,
    COALESCE(
      NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(btrim(u.raw_user_meta_data ->> 'name'), '')
    ),
    COALESCE(
      NULLIF(btrim(u.raw_user_meta_data ->> 'avatar_url'), ''),
      NULLIF(btrim(u.raw_user_meta_data ->> 'picture'), '')
    )
  FROM auth.users u
  WHERE u.id = ANY (p_user_ids);
$$;

REVOKE ALL ON FUNCTION public.get_user_profiles(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_profiles(uuid[]) TO service_role;

COMMENT ON FUNCTION public.get_user_profiles(uuid[]) IS
  'id, email, full_name (full_name > name) e avatar_url (avatar_url > picture) de auth.users para os ids pedidos. Substitui N chamadas a auth.admin.getUserById. Só service_role.';

COMMIT;
