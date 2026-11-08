import { calculateEngagementScore, type InteractionSignal } from '@/features/leads/services/engagement-score.service';

/**
 * Score de prioridade de ligacao v2 (PR11). Modulo PURO: sem I/O, sem relogio
 * implicito, deterministico (mesmas entradas, mesma saida).
 *
 * Separa duas coisas que o engagement score atual mistura:
 *  - INTERESSE real: resposta explicita, reuniao marcada, resultado de ligacao
 *    informado pelo SDR, classificacao da transcricao e BANT;
 *  - ESFORCO de envio: enviado, entregue, aberto, clicado (reusa
 *    `calculateEngagementScore` so com esses tipos).
 *
 * score = interesse * 10 + esforco, com esforco entre 0 e EFFORT_MAX (9). Logo
 * qualquer interesse (>= 1) vale mais que todo o esforco possivel: sinal de envio
 * NUNCA vence resposta explicita. Resposta explicita ainda tem piso proprio.
 *
 * Idempotencia: cada sinal tem uma chave; chave repetida conta uma vez so (replay
 * de webhook ou reprocessamento). Cada ligacao tem no maximo um resultado efetivo
 * por autor, e o do SDR prevalece sobre o da IA.
 *
 * Correcao humana: a mais recente SUBSTITUI o interesse calculado (o esforco
 * continua). Os sinais anteriores ficam listados em `ignored`, nunca apagados.
 *
 * Transcricao ausente, com baixa confianca, com falha ou marcada para revisao
 * NAO contribui e NAO penaliza: vira item em `missing` ou `ignored`.
 *
 * Nada aqui altera politica comercial, cadencia ou prompt.
 */

export const CALL_PRIORITY_MODEL_VERSION = 'call_priority_v2.0';
export const CALL_PRIORITY_FLAG_KEY = 'call_priority_v2';

/** Mesma confianca minima que o cockpit usa para aplicar o resultado da IA (ai-outcome.ts). */
export const MIN_TRANSCRIPT_CONFIDENCE = 0.7;
/** Esforco maximo. Menor que o passo do interesse (10), por construcao. */
export const EFFORT_MAX = 9;
export const INTEREST_MAX = 100;
export const INTEREST_WEIGHT = 10;

export const REPLY_POINTS = 40;
export const REPLY_EXTRA_POINTS = 5;
export const REPLY_MAX_EXTRA = 2;
export const REPLY_FLOOR = 25;
export const MEETING_POINTS = 60;
export const MEETING_FLOOR = 40;
export const BANT_POINTS_PER_FIELD = 5;
export const BANT_MAX_FIELDS = 4;

const DECAY_WINDOW_DAYS = 90;
const MIN_DECAY = 0.4;
const DAY_MS = 86_400_000;

export type PrioritySource =
  | 'explicit_reply'
  | 'call_outcome_sdr'
  | 'transcript_classification'
  | 'bant'
  | 'send_effort'
  | 'human';

export const PRIORITY_SOURCE_LABELS: Record<PrioritySource, string> = {
  explicit_reply: 'resposta explícita',
  call_outcome_sdr: 'resultado da ligação',
  transcript_classification: 'classificação da transcrição',
  bant: 'BANT',
  send_effort: 'esforço de envio',
  human: 'correção humana',
};

const CALL_DISPOSITION_POINTS: Record<string, number> = {
  relevant_conversation: 30,
  callback_requested: 35,
  answered_no_progress: 8,
  voicemail: 0,
  no_answer: 0,
  technical_failure: 0,
};

const CALL_DISPOSITION_LABELS: Record<string, string> = {
  relevant_conversation: 'conversa relevante',
  callback_requested: 'pediu para ligar depois',
  answered_no_progress: 'atendeu, sem avanço',
  voicemail: 'caixa postal',
  no_answer: 'não atendeu',
  technical_failure: 'falha técnica',
};

const SEND_TYPES = ['sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed'] as const;

interface BaseSignal {
  /** Chave de idempotencia do sinal. Repetida = ignorada. */
  key: string;
  /** ISO 8601. */
  at: string;
}

export type PrioritySignal =
  | (BaseSignal & { kind: 'reply'; channel: string })
  | (BaseSignal & { kind: 'meeting_scheduled' })
  | (BaseSignal & {
      kind: 'call_outcome';
      callId: string;
      by: 'sdr' | 'ai';
      disposition: string;
      /** So para `ai`. Ausente conta como baixa confianca. */
      confidence?: number | null;
      /** So para `ai`: marcado para revisao humana. */
      needsReview?: boolean;
    })
  | (BaseSignal & { kind: 'bant'; filledFields: number })
  | (BaseSignal & { kind: 'send'; channel: string; type: string })
  | (BaseSignal & { kind: 'human_correction'; actorUserId: string; interest: number });

export type PriorityMissing = 'transcript' | 'bant' | 'reply' | 'call_outcome';

export interface PriorityReason {
  code: string;
  label: string;
  source: PrioritySource;
  points: number;
}

export interface PriorityIgnored {
  key: string;
  reason:
    | 'duplicate'
    | 'superseded_by_sdr'
    | 'low_confidence'
    | 'needs_review'
    | 'unknown_disposition'
    | 'overridden_by_human_correction'
    | 'older_correction'
    | 'invalid';
}

export interface PriorityResult {
  version: typeof CALL_PRIORITY_MODEL_VERSION;
  /** interesse * 10 + esforco. Comparavel entre leads. */
  score: number;
  interest: number;
  effort: number;
  /** Fonte que mais contribuiu para o interesse; send_effort se so houver envio; null sem sinal. */
  primarySource: PrioritySource | null;
  reasons: PriorityReason[];
  ignored: PriorityIgnored[];
  missing: PriorityMissing[];
  /** Houve correcao humana vigente. */
  humanCorrected: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function decay(at: string, now: Date): number {
  const days = (now.getTime() - new Date(at).getTime()) / DAY_MS;
  if (!Number.isFinite(days)) return MIN_DECAY;
  return Math.max(MIN_DECAY, 1 - Math.max(0, days) / DECAY_WINDOW_DAYS);
}

function validAt(at: string): boolean {
  return Number.isFinite(new Date(at).getTime());
}

/** Descarta chaves repetidas. A primeira ocorrencia vale; as demais viram `duplicate`. */
function dedupe(signals: PrioritySignal[], ignored: PriorityIgnored[]): PrioritySignal[] {
  const seen = new Set<string>();
  const out: PrioritySignal[] = [];
  for (const s of signals) {
    if (!s.key || !validAt(s.at)) {
      ignored.push({ key: s.key, reason: 'invalid' });
      continue;
    }
    if (seen.has(s.key)) {
      ignored.push({ key: s.key, reason: 'duplicate' });
      continue;
    }
    seen.add(s.key);
    out.push(s);
  }
  return out;
}

/**
 * Calcula a prioridade de UM lead. `signals` deve conter somente sinais desse lead
 * e da organizacao dele (o isolamento por organizacao e responsabilidade de quem
 * carrega os sinais; ver `loadPrioritySignals`).
 */
export function computeCallPriority(signals: PrioritySignal[], now: Date): PriorityResult {
  const ignored: PriorityIgnored[] = [];
  const unique = dedupe(signals, ignored);
  const reasons: PriorityReason[] = [];
  const missing: PriorityMissing[] = [];

  // --- Resultado de ligacao: um efetivo por ligacao; SDR prevalece sobre a IA ---
  const outcomes = unique.filter((s): s is Extract<PrioritySignal, { kind: 'call_outcome' }> => s.kind === 'call_outcome');
  const sdrCalls = new Set(outcomes.filter((o) => o.by === 'sdr').map((o) => o.callId));
  const effectiveByCall = new Map<string, Extract<PrioritySignal, { kind: 'call_outcome' }>>();
  for (const o of outcomes) {
    if (o.by === 'ai') {
      if (sdrCalls.has(o.callId)) {
        ignored.push({ key: o.key, reason: 'superseded_by_sdr' });
        continue;
      }
      if (o.needsReview === true) {
        ignored.push({ key: o.key, reason: 'needs_review' });
        continue;
      }
      if (typeof o.confidence !== 'number' || !(o.confidence >= MIN_TRANSCRIPT_CONFIDENCE)) {
        ignored.push({ key: o.key, reason: 'low_confidence' });
        continue;
      }
    }
    if (!(o.disposition in CALL_DISPOSITION_POINTS)) {
      ignored.push({ key: o.key, reason: 'unknown_disposition' });
      continue;
    }
    const current = effectiveByCall.get(o.callId);
    // Um por ligacao: mantem o mais recente; empate pela chave, para ser deterministico.
    if (!current || o.at > current.at || (o.at === current.at && o.key < current.key)) {
      if (current) ignored.push({ key: current.key, reason: 'duplicate' });
      effectiveByCall.set(o.callId, o);
    } else {
      ignored.push({ key: o.key, reason: 'duplicate' });
    }
  }

  // --- Pontos de interesse por origem ---
  const computed: PriorityReason[] = [];

  const replies = unique.filter((s): s is Extract<PrioritySignal, { kind: 'reply' }> => s.kind === 'reply');
  if (replies.length > 0) {
    const latest = replies.reduce((a, b) => (b.at > a.at ? b : a));
    const base = REPLY_POINTS + Math.min(REPLY_MAX_EXTRA, replies.length - 1) * REPLY_EXTRA_POINTS;
    const points = Math.max(REPLY_FLOOR, Math.round(base * decay(latest.at, now)));
    computed.push({ code: 'explicit_reply', label: `Respondeu por ${latest.channel}`, source: 'explicit_reply', points });
  } else {
    missing.push('reply');
  }

  const meetings = unique.filter((s) => s.kind === 'meeting_scheduled');
  if (meetings.length > 0) {
    const latest = meetings.reduce((a, b) => (b.at > a.at ? b : a));
    const points = Math.max(MEETING_FLOOR, Math.round(MEETING_POINTS * decay(latest.at, now)));
    computed.push({ code: 'meeting_scheduled', label: 'Reunião marcada', source: 'explicit_reply', points });
  }

  for (const o of effectiveByCall.values()) {
    const base = CALL_DISPOSITION_POINTS[o.disposition] ?? 0;
    const label = CALL_DISPOSITION_LABELS[o.disposition] ?? o.disposition;
    if (o.by === 'sdr') {
      const points = Math.round(base * decay(o.at, now));
      computed.push({ code: `call_outcome:${o.disposition}`, label: `Ligação: ${label}`, source: 'call_outcome_sdr', points });
    } else {
      const points = Math.round(base * (o.confidence ?? 0) * decay(o.at, now));
      computed.push({
        code: `transcript:${o.disposition}`,
        label: `Transcrição classificada: ${label}`,
        source: 'transcript_classification',
        points,
      });
    }
  }
  if (effectiveByCall.size === 0) missing.push('call_outcome');
  // Transcricao ausente, com falha, baixa confianca ou em revisao: sem contribuicao e sem penalidade.
  if (![...effectiveByCall.values()].some((o) => o.by === 'ai')) missing.push('transcript');

  const bants = unique.filter((s): s is Extract<PrioritySignal, { kind: 'bant' }> => s.kind === 'bant');
  const filled = bants.length > 0 ? Math.max(...bants.map((b) => clamp(Math.trunc(b.filledFields), 0, BANT_MAX_FIELDS))) : 0;
  if (filled > 0) {
    // Varios sinais de BANT nao somam: vale o preenchimento mais completo.
    computed.push({
      code: 'bant',
      label: `BANT preenchido (${filled} de ${BANT_MAX_FIELDS})`,
      source: 'bant',
      points: filled * BANT_POINTS_PER_FIELD,
    });
  } else {
    missing.push('bant');
  }

  // --- Correcao humana: a mais recente substitui o interesse calculado ---
  const corrections = unique.filter((s): s is Extract<PrioritySignal, { kind: 'human_correction' }> => s.kind === 'human_correction');
  let correction: Extract<PrioritySignal, { kind: 'human_correction' }> | null = null;
  for (const c of corrections) {
    if (!correction || c.at > correction.at || (c.at === correction.at && c.key > correction.key)) {
      if (correction) ignored.push({ key: correction.key, reason: 'older_correction' });
      correction = c;
    } else {
      ignored.push({ key: c.key, reason: 'older_correction' });
    }
  }

  let interest: number;
  if (correction) {
    interest = clamp(Math.round(correction.interest), 0, INTEREST_MAX);
    for (const s of unique) {
      if (s.kind === 'reply' || s.kind === 'meeting_scheduled' || s.kind === 'call_outcome' || s.kind === 'bant') {
        ignored.push({ key: s.key, reason: 'overridden_by_human_correction' });
      }
    }
    reasons.push({ code: 'human_correction', label: `Ajuste manual de interesse para ${interest}`, source: 'human', points: interest });
  } else {
    interest = clamp(
      computed.reduce((sum, r) => sum + r.points, 0),
      0,
      INTEREST_MAX,
    );
    reasons.push(...computed.filter((r) => r.points > 0).sort((a, b) => b.points - a.points || a.code.localeCompare(b.code)));
  }

  // --- Esforco de envio (reusa o engagement score so com tipos de envio) ---
  const sends = unique.filter((s): s is Extract<PrioritySignal, { kind: 'send' }> => s.kind === 'send' && (SEND_TYPES as readonly string[]).includes(s.type));
  const sendSignals: InteractionSignal[] = sends.map((s) => ({ type: s.type, channel: s.channel, created_at: s.at }));
  const engagement = calculateEngagementScore(sendSignals, now) ?? 0;
  // ceil: qualquer envio com peso positivo conta ao menos 1; o teto EFFORT_MAX segue valendo.
  const effort = Math.min(EFFORT_MAX, Math.ceil((engagement / 100) * EFFORT_MAX));
  if (effort > 0) {
    reasons.push({ code: 'send_effort', label: 'Esforço de envio recente', source: 'send_effort', points: effort });
  }

  const primarySource: PrioritySource | null = reasons[0]?.source ?? null;

  return {
    version: CALL_PRIORITY_MODEL_VERSION,
    score: interest * INTEREST_WEIGHT + effort,
    interest,
    effort,
    primarySource,
    reasons,
    ignored,
    missing: [...new Set(missing)],
    humanCorrected: correction !== null,
  };
}

export interface RankCandidate {
  leadId: string;
  /** Desempate: lead atualizado mais recentemente primeiro (igual ao pickNextLead atual). */
  updatedAt: string;
  signals: PrioritySignal[];
}

export interface RankedLead {
  leadId: string;
  result: PriorityResult;
}

/** Ordena do mais para o menos prioritario. Empate: updatedAt desc, depois leadId asc. */
export function rankLeadsByPriority(candidates: RankCandidate[], now: Date): RankedLead[] {
  return candidates
    .map((c) => ({ c, result: computeCallPriority(c.signals, now) }))
    .sort((a, b) => {
      if (b.result.score !== a.result.score) return b.result.score - a.result.score;
      const byUpdated = b.c.updatedAt.localeCompare(a.c.updatedAt);
      if (byUpdated !== 0) return byUpdated;
      return a.c.leadId.localeCompare(b.c.leadId);
    })
    .map(({ c, result }) => ({ leadId: c.leadId, result }));
}
