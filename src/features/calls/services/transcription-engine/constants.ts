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

/** Tolerância entre calls.duration_seconds e a duração do áudio baixado: o maior entre 10 s e 25%. */
export const DURATION_TOLERANCE_RATIO = 0.25;
export const DURATION_TOLERANCE_MIN_SECONDS = 10;

/**
 * Áudio MAIOR que o registrado no banco (duração curta registrada) ainda é aceito, com aviso,
 * se audio - call <= max(30 s, 50% da ligação). Acima disso é provável áudio de outra ligação.
 */
export const DURATION_LONGER_SLACK_MIN_SECONDS = 30;
export const DURATION_LONGER_SLACK_RATIO = 0.5;

/** Prefixos gravados em call_transcripts_v2.error. Só a recusa conta no monitoramento. */
export const DURATION_MISMATCH_PREFIX = 'duration_mismatch';
export const DURATION_WARNING_PREFIX = 'duration_warning';

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

/** Confiança de outcome ou next_step abaixo disso marca needs_review. */
export const JEV_LOW_CONFIDENCE = 0.6;

/** Com outcome e next_step nesta confiança ou acima, indecisão em objeções não marca revisão. */
export const JEV_HIGH_CONFIDENCE = 0.8;

/** Noul a menos disso de 0,5 é indecisão (vale só quando outcome e next_step não estão altos). */
export const JEV_NOUL_UNDECIDED_BAND = 0.15;

/**
 * Palavras-chave do AssemblyAI (keyterms_prompt, suportado no universal-3-5-pro:
 * até 1000 termos, no máximo 6 palavras por frase). Não enviamos `prompt` junto.
 * Nomes dos SDRs ativos da V4 e vocabulário do negócio.
 */
export const ASSEMBLYAI_KEYTERMS_PROMPT: string[] = [
  'V4 Company',
  'V4',
  'Ismael Dobelin',
  'Guilherme Marques',
  'Giovanni Olivieri',
  'João Fogaça',
  'Fogaça',
  'Matheus Martins',
  'Ana Luiza',
  'tráfego pago',
  'CRM',
  'performance',
];
