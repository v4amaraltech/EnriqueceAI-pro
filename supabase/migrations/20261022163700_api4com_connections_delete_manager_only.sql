-- Só o gestor apaga a linha de ramal (api4com_connections).
-- Com o token da conta pai, o SDR que clicava "Desconectar" apagava o próprio
-- ramal e o "Sincronizar ramais" não recriava (e-mail ambíguo por causa dos
-- ramais duplicados 1047–1054) — o time inteiro ficou sem ligar em 22/10/2026.
BEGIN;

DROP POLICY IF EXISTS "Users can delete own api4com connection" ON public.api4com_connections;

CREATE POLICY "Managers can delete api4com connection" ON public.api4com_connections
  FOR DELETE
  USING (org_id = (SELECT public.user_org_id()) AND (SELECT public.is_manager()));

COMMIT;
