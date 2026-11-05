// Resultado da ligação classificado pela IA (Power Dialer automático, nov/2026).
//
// Módulo PURO (sem I/O) — importável pelo client (selo na timeline) e pelo
// server (webhook, cron, transcrição).
//
// Fluxo: o Power Dialer conclui sozinho a ligação atendida e grava
// `calls.metadata.ai_outcome = { status: 'pending' }`. A transcrição roda com
// piso de 10 s (em vez dos 5 min do BANT), a IA classifica e grava
// `ai_outcome = { status: 'done', ... }` (ou `failed`).
//
// Marcador: `calls.origin` da ligação do Power Dialer é o RAMAL (vem do
// `initiateApi4ComCall`), não 'power_dialer' — por isso o critério é só o
// `ai_outcome.status`.
import { TRANSCRIPTION_MIN_DURATION_SECONDS } from './schemas/call.schemas';

/** Piso de duração para transcrever uma ligação que espera o resultado da IA.
 *  Abaixo disso o áudio é praticamente vazio (toque/queda). */
export const AI_OUTCOME_MIN_DURATION_SECONDS = 10;

/** Abaixo desta confiança o resultado vai com o selo "Revisar". */
export const AI_OUTCOME_REVIEW_CONFIDENCE = 0.7;

export const aiDispositionValues = [
  'relevant_conversation',
  'answered_no_progress',
  'callback_requested',
  'voicemail',
  'technical_failure',
] as const;
export type AiDisposition = (typeof aiDispositionValues)[number];

/** `processing` = uma execução já pegou a ligação (trava contra classificar 2x). */
export type AiOutcomeStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface AiOutcome {
  status: AiOutcomeStatus;
  disposition?: AiDisposition | null;
  confidence?: number | null;
  summary?: string | null;
  /** ISO com fuso (horário pedido pelo lead, ou próximo dia útil 9h BRT). */
  callback_at?: string | null;
  scheduled_activity_id?: string | null;
  model?: string | null;
  needs_review?: boolean;
  classified_at?: string | null;
  started_at?: string | null;
  error?: string | null;
}

/** Lê `metadata.ai_outcome` de uma linha de `calls` (tolerante a lixo). */
export function readAiOutcome(metadata: unknown): AiOutcome | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const raw = (metadata as Record<string, unknown>).ai_outcome;
  if (!raw || typeof raw !== 'object') return null;
  const status = (raw as Record<string, unknown>).status;
  if (status !== 'pending' && status !== 'processing' && status !== 'done' && status !== 'failed') return null;
  return raw as AiOutcome;
}

/** A ligação está esperando o resultado da IA? */
export function isAiOutcomePending(metadata: unknown): boolean {
  return readAiOutcome(metadata)?.status === 'pending';
}

/** Duração mínima para transcrever ESTA ligação: 10 s se espera a IA, senão a
 *  regra geral (BANT, 5 min). */
export function transcriptionMinDurationFor(metadata: unknown): number {
  return isAiOutcomePending(metadata) ? AI_OUTCOME_MIN_DURATION_SECONDS : TRANSCRIPTION_MIN_DURATION_SECONDS;
}

/** Deve disparar a transcrição no hangup? */
export function shouldTranscribeOnHangup(args: {
  recordUrl: string | null | undefined;
  durationSeconds: number;
  metadata: unknown;
}): boolean {
  return !!args.recordUrl && args.durationSeconds >= transcriptionMinDurationFor(args.metadata);
}

export const AI_DISPOSITION_LABELS: Record<AiDisposition, string> = {
  relevant_conversation: 'Conversa relevante',
  answered_no_progress: 'Atendeu, sem avanço',
  callback_requested: 'Pediu para ligar depois',
  voicemail: 'Caixa postal',
  technical_failure: 'Falha técnica',
};
