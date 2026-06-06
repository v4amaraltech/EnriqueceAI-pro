-- Storage durável para gravações de ligação.
--
-- A API4COM entrega no webhook um link efêmero (listener.api4com.com/files/listen/...)
-- que expira em poucas horas (testado: 404 no mesmo dia). O arquivo durável existe
-- na API4COM (host fs*.api4com.com, via API /calls → record_url), mas depende da
-- retenção deles. Para "ter a gravação como premissa", passamos a baixar o áudio e
-- guardar no nosso próprio Storage (bucket privado), servindo o player a partir dele.
--
-- Bucket privado (não público): gravações de vendas são sensíveis e nunca devem ser
-- acessíveis por URL pública. O acesso é feito via service role no proxy autenticado
-- (/api/proxy/recording), com checagem de org — mesmo modelo já usado hoje.

BEGIN;

-- Onde o objeto vive no bucket: {org_id}/{call_id}.mp3 (null = ainda não persistido).
ALTER TABLE calls ADD COLUMN IF NOT EXISTS recording_storage_path text;

-- Bucket privado para os áudios.
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-recordings', 'call-recordings', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;
