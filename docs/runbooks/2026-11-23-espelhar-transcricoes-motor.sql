-- Passivo: copia para calls.transcription o texto das transcrições do motor (AssemblyAI)
-- já completed, quando calls.transcription está vazia.
-- Story: docs/stories/transcription-engine-visible-backlog.story.md (AC 4).
-- Mesma regra de buildCallTranscriptMirror (orchestrator.ts):
--   - nunca sobrescreve texto existente;
--   - se o Whisper ainda vai rodar (status null/pending/processing e duração >= 300 s,
--     ou >= 10 s com ai_outcome pendente), grava só o texto;
--   - senão grava o texto + transcription_status = 'completed' e limpa transcription_error.
-- Simulação de 23/11/2026: 768 ligações (767 skipped + 1 failed), 273 delas de 90 s+ em novembro.
-- RODAR SÓ COM OK DO VINI.

BEGIN;

-- Backup do que muda (status/erro; o texto antes era vazio).
CREATE TABLE IF NOT EXISTS public._bkp_calls_transcription_mirror_20261123 AS
SELECT c.id, c.transcription, c.transcription_status, c.transcription_error, c.updated_at
FROM public.calls c
WHERE false;

WITH v AS (
  SELECT DISTINCT ON (call_id) call_id, text
  FROM public.call_transcripts_v2
  WHERE provider = 'assemblyai' AND status = 'completed' AND btrim(coalesce(text, '')) <> ''
  ORDER BY call_id, updated_at DESC
),
alvo AS (
  SELECT c.id, v.text,
    (c.transcription_status IS NULL OR c.transcription_status IN ('pending', 'processing'))
      AND c.duration_seconds >= CASE WHEN c.metadata->'ai_outcome'->>'status' = 'pending' THEN 10 ELSE 300 END
      AS whisper_vai_rodar
  FROM public.calls c
  JOIN v ON v.call_id = c.id
  WHERE btrim(coalesce(c.transcription, '')) = ''
),
bkp AS (
  INSERT INTO public._bkp_calls_transcription_mirror_20261123
  SELECT c.id, c.transcription, c.transcription_status, c.transcription_error, c.updated_at
  FROM public.calls c JOIN alvo a ON a.id = c.id
  RETURNING id
)
UPDATE public.calls c
SET transcription = a.text,
    transcription_status = CASE WHEN a.whisper_vai_rodar THEN c.transcription_status ELSE 'completed' END,
    transcription_error = CASE WHEN a.whisper_vai_rodar THEN c.transcription_error ELSE NULL END,
    updated_at = now()
FROM alvo a
WHERE c.id = a.id
  AND btrim(coalesce(c.transcription, '')) = '';

-- Conferência: cobertura de 90 s+ em novembro (esperado ~328 de ~422 em 23/11).
SELECT count(*) AS total,
       count(*) FILTER (WHERE btrim(coalesce(transcription, '')) <> '') AS com_texto
FROM public.calls
WHERE started_at >= '2026-11-01T03:00:00Z' AND duration_seconds >= 90;

COMMIT;
-- Desfazer: UPDATE calls c SET transcription = b.transcription, transcription_status = b.transcription_status,
--   transcription_error = b.transcription_error FROM _bkp_calls_transcription_mirror_20261123 b WHERE c.id = b.id;
