/** Chave em public.app_flags. Desligada por padrão; ligue por org em allow_org_ids. */
export const TRANSCRIPTION_ENGINE_FLAG_KEY = 'call_transcription_engine_v1';

export const ENGINE_PROVIDER_TRANSCRIPT = 'assemblyai';
export const ENGINE_PROVIDER_QUALIFICATION = 'jev';

export const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com/v2';
export const ASSEMBLYAI_SPEECH_MODEL = 'universal-3-5-pro';
export const ASSEMBLYAI_LANGUAGE = 'pt';

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';

/** Só ligações atendidas com pelo menos isso entram no motor. */
export const ENGINE_MIN_DURATION_SECONDS = 30;

/** Tolerância entre calls.duration_seconds e a duração do áudio baixado. */
export const DURATION_TOLERANCE_RATIO = 0.15;
export const DURATION_TOLERANCE_MIN_SECONDS = 5;

/** Depois disso a linha em failed deixa de ser reprocessada. */
export const MAX_ATTEMPTS = 3;

/**
 * Estimativa de custo. AssemblyAI cobra por segundo de áudio enviado:
 * áudio estéreo conta os dois canais (2x), por isso o downmix para mono antes do envio.
 * Valor por hora de áudio (modelo + speaker labels). CONFIRME com a fatura e ajuste aqui.
 */
export const ASSEMBLYAI_USD_PER_AUDIO_HOUR = 0.23;

/** JEV: US$ 0,042 por milhão de tokens de entrada; saída é gratuita. */
export const JEV_USD_PER_INPUT_MTOK = 0.042;

/** Abaixo disso a pergunta marca needs_review. */
export const JEV_LOW_CONFIDENCE = 0.6;
