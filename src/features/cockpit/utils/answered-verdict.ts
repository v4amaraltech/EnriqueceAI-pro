/**
 * Veredito "conversou?" de uma ligação atendida (PR-A). Módulo PURO, sem rede nem relógio.
 *
 * `answered_at` sozinho é um sinal fraco: "atendeu" inclui a caixa postal (nos dados da V4, 30 dias, das ligações
 * atendidas com menos de 10 s, 486 foram caixa postal e só 7 conversa). Por isso o veredito cruza a duração com a
 * previsão da escuta ao vivo (`calls.metadata.live_amd`). Só quem CONVERSOU mostra as três ações (Agendar reunião,
 * Ligar depois, Desqualificar); máquina, caixa postal e não atendeu voltam para a fila sozinhos.
 * Na dúvida (sem dados) o veredito é "conversou": preferimos o falso positivo, que custa 1 clique.
 */

/** Atendida há pelo menos isto (segundos) e sem sinal de máquina = conversa. */
export const ANSWERED_MIN_TALK_SECONDS = 10;
/** Confiança mínima (0 a 1) para a previsão de máquina valer sobre a duração. */
export const AMD_MACHINE_MIN_CONFIDENCE = 0.85;

/** Valores gravados em `metadata.live_amd.prediction` (ver `record-live-amd.ts`). */
export type AmdPrediction = 'human' | 'voicemail' | 'no_answer' | 'number_not_exist' | 'unknown';

export interface AmdReading {
  prediction: AmdPrediction;
  /** 0 a 1; null se não veio um número válido. */
  confidence: number | null;
}

const AMD_PREDICTIONS: ReadonlySet<string> = new Set<AmdPrediction>(['human', 'voicemail', 'no_answer', 'number_not_exist', 'unknown']);
/** Previsões que significam "não é uma pessoa falando" (as mesmas que a escuta ao vivo trata como sinal claro). */
const MACHINE_PREDICTIONS: ReadonlySet<string> = new Set<AmdPrediction>(['voicemail', 'no_answer', 'number_not_exist']);

export type AnsweredReason = 'not_answered' | 'machine' | 'human' | 'long_enough' | 'too_short' | 'unknown_fail_open';

export interface AnsweredVerdict {
  verdict: 'conversou' | 'nao_conversou';
  reason: AnsweredReason;
}

export interface AnsweredVerdictInput {
  /** `calls.answered_at` (ISO); null/vazio = a perna do lead não atendeu. */
  answeredAt: string | null;
  /** `calls.duration_seconds`, em SEGUNDOS; null = ainda sem duração. */
  durationSeconds: number | null;
  amdPrediction: AmdPrediction | null;
  /** 0 a 1. */
  amdConfidence: number | null;
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Lê `metadata.live_amd` (prediction e confidence). Tolerante: metadata nulo, vazio ou de tipo errado => null. */
export function extractAmd(metadata: unknown): AmdReading | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const amd = (metadata as Record<string, unknown>).live_amd;
  if (typeof amd !== 'object' || amd === null || Array.isArray(amd)) return null;
  const { prediction, confidence } = amd as Record<string, unknown>;
  if (typeof prediction !== 'string' || !AMD_PREDICTIONS.has(prediction)) return null;
  return {
    prediction: prediction as AmdPrediction,
    confidence: isNumber(confidence) && confidence >= 0 && confidence <= 1 ? confidence : null,
  };
}

/** Regras em ordem: sem atendimento; máquina com confiança; humano; duração; curta; sem dados (conversou). */
export function getAnsweredVerdict(input: AnsweredVerdictInput): AnsweredVerdict {
  const answered = Boolean(input.answeredAt && input.answeredAt.trim());
  if (!answered) return { verdict: 'nao_conversou', reason: 'not_answered' };

  const { amdPrediction, amdConfidence } = input;
  if (
    amdPrediction !== null &&
    MACHINE_PREDICTIONS.has(amdPrediction) &&
    isNumber(amdConfidence) &&
    amdConfidence >= AMD_MACHINE_MIN_CONFIDENCE
  ) {
    return { verdict: 'nao_conversou', reason: 'machine' };
  }
  // O "alô" e a queda são conversa curta: a previsão de humano vale mesmo com poucos segundos.
  if (amdPrediction === 'human') return { verdict: 'conversou', reason: 'human' };

  if (isNumber(input.durationSeconds)) {
    return input.durationSeconds >= ANSWERED_MIN_TALK_SECONDS
      ? { verdict: 'conversou', reason: 'long_enough' }
      : { verdict: 'nao_conversou', reason: 'too_short' };
  }
  return { verdict: 'conversou', reason: 'unknown_fail_open' };
}

/** Mesmo piso do desligamento automático da escuta (`LIVE_AMD_AUTOHANGUP_MIN_CONFIDENCE`, calls/live-amd-phrases). */
export const AUTO_HANGUP_MIN_CONFIDENCE = 0.84;

export interface AutoHangupReading {
  prediction: 'voicemail' | 'no_answer' | 'number_not_exist';
  confidence: number;
}

/**
 * Lê `metadata.live_amd.auto_hangup`: a marca que a escuta grava SÓ quando de fato desligou a ligação (live-amd-browser).
 * Exige a frase, a predição de operadora (caixa postal / não atendeu / número inexistente) e a confiança DA PRÓPRIA marca
 * >= 0,84. Nada além disso vale: `prediction`/`next_activity_confidence` soltos podem ser de conversa real.
 */
export function extractAutoHangup(metadata: unknown): AutoHangupReading | null {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const amd = (metadata as Record<string, unknown>).live_amd;
  if (typeof amd !== 'object' || amd === null || Array.isArray(amd)) return null;
  const mark = (amd as Record<string, unknown>).auto_hangup;
  if (typeof mark !== 'object' || mark === null || Array.isArray(mark)) return null;
  const { prediction, confidence, phrase } = mark as Record<string, unknown>;
  if (typeof phrase !== 'string' || !phrase.trim()) return null;
  if (prediction !== 'voicemail' && prediction !== 'no_answer' && prediction !== 'number_not_exist') return null;
  if (!isNumber(confidence) || confidence < AUTO_HANGUP_MIN_CONFIDENCE || confidence > 1) return null;
  return { prediction, confidence };
}
