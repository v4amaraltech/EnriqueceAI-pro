import {
  DURATION_WARNING_PREFIX,
  JEV_HIGH_CONFIDENCE,
  JEV_LOW_CONFIDENCE,
  JEV_NOUL_UNDECIDED_BAND,
} from './constants';

/** Códigos estáveis gravados em call_qualifications.needs_review_reasons. */
export const NEEDS_REVIEW_REASONS = {
  missingOutcomeConfidence: 'missing_outcome_confidence',
  outcomeLowConfidence: 'outcome_low_confidence',
  missingNextStepConfidence: 'missing_next_step_confidence',
  nextStepLowConfidence: 'next_step_low_confidence',
  interestLowConfidence: 'interest_low_confidence',
  objectionTypeLowConfidence: 'objection_type_low_confidence',
  ambiguousNoul: 'ambiguous_noul',
  incoherentOutcomeNextStep: 'incoherent_outcome_next_step',
  durationWarning: 'duration_warning',
  suspiciousAudioVoicemailUnrelated: 'suspicious_audio_voicemail_unrelated',
  suspiciousAudioSpeakerAnomaly: 'suspicious_audio_speaker_anomaly',
} as const;

export type NeedsReviewReason = (typeof NEEDS_REVIEW_REASONS)[keyof typeof NEEDS_REVIEW_REASONS];

/**
 * Pares outcome → next_step que se contradizem.
 * not_connected + callback/not_connected/none continua válido (tentar de novo).
 */
export const INCOHERENT_OUTCOME_NEXT_STEPS: ReadonlyArray<readonly [string, string]> = [
  ['not_interested', 'callback'],
  ['not_interested', 'meeting'],
  ['not_connected', 'meeting'],
];

/** Chaves de ICP/BANT na resposta crua do Jev. */
export const ICP_ANSWER_KEYS = [
  'monthly_revenue',
  'headcount',
  'digital_maturity',
  'decision_maker',
  'bant_budget',
  'bant_authority',
  'bant_need',
  'bant_timeline',
] as const;

/** Sobras de texto depois de tirar o prompt de caixa postal/URA, em caracteres. */
export const SUSPICIOUS_AUDIO_LEFTOVER_MIN_CHARS = 200;

/** Quantidade de speakers a partir da qual uma ligação 1:1 é anômala. */
export const SUSPICIOUS_SPEAKER_COUNT_MIN = 5;

const MAILBOX_RE =
  /caixa postal|correio de voz|deixe(?: a)? (?:sua|outra) mensagem|grave(?: a)? sua mensagem|ap[oó]s o sinal|pode desligar quando terminar|sua chamada foi encaminhada/gi;

const IVR_RE =
  /se voc[eê] disser seu nome|motivo da (?:liga[cç][aã]o|chamada)|permane[cç]a na linha|n[aã]o est[aá] dispon[ií]vel|poderei ver se esta pessoa|esta pessoa n[aã]o est[aá] dispon[ií]vel/gi;

export function hasDurationWarning(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(DURATION_WARNING_PREFIX);
}

export function isIncoherentOutcomeNextStep(outcome: string, nextStep: string): boolean {
  return INCOHERENT_OUTCOME_NEXT_STEPS.some(([o, n]) => o === outcome && n === nextStep);
}

/**
 * Outcome not_connected com confiança suficiente para não usar interest/ICP na revisão.
 * O limiar é o baixo (0,6): se já confiamos que não houve conversa, interest e BANT não se aplicam.
 */
export function isTrustedNotConnected(outcome: string, outcomeConf: number | undefined): boolean {
  return outcome === 'not_connected' && typeof outcomeConf === 'number' && outcomeConf >= JEV_LOW_CONFIDENCE;
}

function leftoverAfterPrompts(text: string): string {
  return text.replace(MAILBOX_RE, ' ').replace(IVR_RE, ' ').replace(/\s+/g, ' ').trim();
}

export function hasMailboxPrompt(text: string): boolean {
  MAILBOX_RE.lastIndex = 0;
  return MAILBOX_RE.test(text);
}

/**
 * Heurística testável de áudio suspeito:
 * - speakers_count = 0 com texto, ou speakers_count >= 5;
 * - prompt de caixa postal/correio de voz seguido de fala longa que não é o recado
 *   (sobra >= 200 caracteres depois de remover o boilerplate de URA/caixa).
 * URA de porteiro + conversa real (sem "deixe sua mensagem") não marca.
 */
export function detectSuspiciousAudio(input: {
  text: string;
  speakersCount?: number | null;
}): NeedsReviewReason | null {
  const text = input.text ?? '';
  const speakers = input.speakersCount;
  if (text.trim().length > 0 && speakers === 0) {
    return NEEDS_REVIEW_REASONS.suspiciousAudioSpeakerAnomaly;
  }
  if (typeof speakers === 'number' && speakers >= SUSPICIOUS_SPEAKER_COUNT_MIN) {
    return NEEDS_REVIEW_REASONS.suspiciousAudioSpeakerAnomaly;
  }
  if (!hasMailboxPrompt(text)) return null;
  const leftover = leftoverAfterPrompts(text);
  if (leftover.length < SUSPICIOUS_AUDIO_LEFTOVER_MIN_CHARS) return null;
  // Caixa postal com recado longo de um speaker só pode ser um voicemail legítimo.
  // Dois ou mais speakers depois do prompt sugerem outra conversa colada no áudio.
  if (typeof speakers === 'number' && speakers < 2) return null;
  return NEEDS_REVIEW_REASONS.suspiciousAudioVoicemailUnrelated;
}

export interface ReviewInput {
  outcome: string;
  nextStep: string;
  outcomeConf?: number;
  nextConf?: number;
  interestConf?: number;
  objectionTypeConf?: number;
  hasObjections: boolean;
  noul: number;
  durationWarning?: boolean;
  transcript?: string;
  speakersCount?: number | null;
}

export interface ReviewDecision {
  needsReview: boolean;
  reasons: NeedsReviewReason[];
  confidence: number;
}

const hasConf = (c: number | undefined): c is number => typeof c === 'number';

/** Decisão pura de needs_review e da confiança relevante (mínimo das perguntas que valem). */
export function evaluateNeedsReview(input: ReviewInput): ReviewDecision {
  const reasons: NeedsReviewReason[] = [];
  const {
    outcome,
    nextStep,
    outcomeConf,
    nextConf,
    interestConf,
    objectionTypeConf,
    hasObjections,
    noul,
  } = input;

  if (!hasConf(outcomeConf)) reasons.push(NEEDS_REVIEW_REASONS.missingOutcomeConfidence);
  else if (outcomeConf < JEV_LOW_CONFIDENCE) reasons.push(NEEDS_REVIEW_REASONS.outcomeLowConfidence);

  if (!hasConf(nextConf)) reasons.push(NEEDS_REVIEW_REASONS.missingNextStepConfidence);
  else if (nextConf < JEV_LOW_CONFIDENCE) reasons.push(NEEDS_REVIEW_REASONS.nextStepLowConfidence);

  const trustedNotConnected = isTrustedNotConnected(outcome, outcomeConf);
  const outcomeNextHigh =
    hasConf(outcomeConf) &&
    hasConf(nextConf) &&
    outcomeConf >= JEV_HIGH_CONFIDENCE &&
    nextConf >= JEV_HIGH_CONFIDENCE;

  const confs: number[] = [outcomeConf, nextConf].filter(hasConf);
  if (!trustedNotConnected && hasConf(interestConf)) confs.push(interestConf);
  if (!outcomeNextHigh && !trustedNotConnected && hasObjections && hasConf(objectionTypeConf)) {
    confs.push(objectionTypeConf);
  }
  const confidence = confs.length ? Math.min(...confs) : 0;

  if (!outcomeNextHigh && !trustedNotConnected) {
    if (hasConf(interestConf) && interestConf < JEV_LOW_CONFIDENCE) {
      reasons.push(NEEDS_REVIEW_REASONS.interestLowConfidence);
    }
    if (hasObjections && hasConf(objectionTypeConf) && objectionTypeConf < JEV_LOW_CONFIDENCE) {
      reasons.push(NEEDS_REVIEW_REASONS.objectionTypeLowConfidence);
    }
    if (Math.abs(noul - 0.5) < JEV_NOUL_UNDECIDED_BAND) {
      reasons.push(NEEDS_REVIEW_REASONS.ambiguousNoul);
    }
  }

  if (isIncoherentOutcomeNextStep(outcome, nextStep)) {
    reasons.push(NEEDS_REVIEW_REASONS.incoherentOutcomeNextStep);
  }
  if (input.durationWarning) reasons.push(NEEDS_REVIEW_REASONS.durationWarning);

  const suspicious = detectSuspiciousAudio({
    text: input.transcript ?? '',
    speakersCount: input.speakersCount,
  });
  if (suspicious) reasons.push(suspicious);

  return { needsReview: reasons.length > 0, reasons, confidence };
}

/** Remove ICP/BANT da cópia persistida quando não houve conversa efetiva. */
export function stripIcpAnswers<T extends Record<string, unknown>>(
  answers: T | undefined,
): T | undefined {
  if (!answers) return answers;
  const next = { ...answers };
  for (const key of ICP_ANSWER_KEYS) delete next[key];
  return next;
}
