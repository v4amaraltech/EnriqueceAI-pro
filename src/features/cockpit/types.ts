export const COCKPIT_TABS = ['tarefas', 'leads', 'dashboard', 'metas', 'closers'] as const;
export type CockpitTab = (typeof COCKPIT_TABS)[number];

export interface CockpitSdrOption {
  userId: string;
  name: string;
}

/** Quem está olhando e de quem são os dados exibidos. */
export interface CockpitViewer {
  viewerId: string;
  orgId: string;
  isManager: boolean;
  /** SDR cujos dados aparecem nas abas (o próprio usuário, se for SDR). */
  targetUserId: string;
  targetName: string;
  /** Opções do seletor (só gestor). */
  sdrOptions: CockpitSdrOption[];
}

// ---------------------------------------------------------------------------
// Contexto de ligação (PR02, flag `call_cockpit_v1`). Somente leitura.
// ---------------------------------------------------------------------------

export const CALL_CONTEXT_MAX_PER_PAGE = 20;
export const CALL_CONTEXT_DEFAULT_PER_PAGE = 5;

export interface CallContextPagination {
  page: number;
  perPage: number;
  /** Total de registros (null se a contagem falhou). */
  total: number | null;
  hasMore: boolean;
}

/** Sinal recente com fonte (canal/origem) e horário. */
export interface CallContextSignal {
  kind: 'replied' | 'clicked' | 'opened' | 'meeting_scheduled' | 'bounced' | 'callback_requested';
  source: string;
  at: string;
}

export interface CallContextInteraction {
  id: string;
  channel: string;
  type: string;
  at: string;
  /** Trecho da mensagem (truncado); null se não houver conteúdo. */
  excerpt: string | null;
  aiGenerated: boolean;
}

export interface CallContextCall {
  id: string;
  at: string;
  durationSeconds: number;
  connected: boolean;
  status: string;
  /** Resultado registrado pelo SDR ou classificado pela IA; null se ausente. */
  outcome: string | null;
  /** Resumo da IA ou anotação do SDR; null se ausente. */
  summary: string | null;
}

export interface CallContextCompany {
  name: string;
  cnpj: string | null;
  segmento: string | null;
  porte: string | null;
  status: string;
}

export interface CallContextDecisionMaker {
  name: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /** Nomes de sócios cadastrados (até 3). Vazio se não houver. */
  partners: string[];
}

export interface CallContext {
  leadId: string;
  /** Motivo explicável para ligar agora; `no_signal` quando não há sinal (ausência explícita). */
  whyNow: { code: 'replied' | 'callback_requested' | 'meeting_no_show' | 'engaged' | 'no_signal'; label: string };
  company: CallContextCompany;
  decisionMaker: CallContextDecisionMaker;
  signals: CallContextSignal[];
  interactions: CallContextInteraction[];
  interactionsPage: CallContextPagination;
  calls: CallContextCall[];
  callsPage: CallContextPagination;
  /** `null` = sem fonte de dados hoje (não é o mesmo que "sem objeções"). */
  objections: string[] | null;
  scores: { fit: number | null; engagement: number | null };
  /** Campos sem dado, para o cartão mostrar a ausência de forma explícita. */
  missing: Array<'contact' | 'signals' | 'interactions' | 'calls' | 'objections' | 'fit' | 'engagement'>;
}

export type CallContextResult =
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'error'; error: string }
  | { status: 'ok'; data: CallContext };

// ---------------------------------------------------------------------------
// Cartão da próxima ligação (PR03, flag `call_cockpit_v1`).
// ---------------------------------------------------------------------------

/** Abordagem sugerida v0: derivada do contexto por regras fixas, sem IA. */
export interface CallApproach {
  version: 'v0';
  headline: string;
  opening: string;
  goal: string;
  points: string[];
}

export interface NextCallCardData {
  context: CallContext;
  approach: CallApproach;
  /** Instante de geração (ISO), para tempos relativos estáveis entre servidor e cliente. */
  generatedAt: string;
}

export type NextCallCardResult =
  | { status: 'disabled' }
  | { status: 'empty' }
  | { status: 'error'; error: string }
  | { status: 'ok'; data: NextCallCardData };

// ---------------------------------------------------------------------------
// Resultado pós-ligação no cockpit (PR04, flag `call_cockpit_outcomes`).
// ---------------------------------------------------------------------------

/**
 * Estado do resultado da ligação para o cartão. Só `waiting_call` e `pending`
 * são provisórios; nenhum deles trava a próxima ligação.
 */
export type CockpitCallOutcome =
  /** A ligação ainda não terminou (webhook não chegou). */
  | { state: 'waiting_call' }
  /** Lead não atendeu: não há transcrição nem resumo a esperar. */
  | { state: 'not_answered'; hangupCause: string | null }
  /** Transcrição ou classificação em andamento. */
  | { state: 'pending'; stage: 'transcription' | 'classification' }
  /** Resultado confirmado (pelo SDR ou pela IA com confiança suficiente). */
  | {
      state: 'confirmed';
      source: 'sdr' | 'ai';
      disposition: string;
      summary: string | null;
      callbackAt: string | null;
      callbackScheduled: boolean;
    }
  /** Resultado da IA que exige revisão humana e NÃO foi aplicado. */
  | {
      state: 'exception';
      reason: 'low_confidence' | 'failed' | 'apply_failed';
      suggestedDisposition: string | null;
      confidence: number | null;
      summary: string | null;
    }
  /** Ligação sem resultado automático (por exemplo, não armada pelo cockpit). */
  | { state: 'none' };

export type CockpitCallOutcomeResult =
  | { status: 'disabled' }
  | { status: 'not_found' }
  | { status: 'error'; error: string }
  | { status: 'ok'; outcome: CockpitCallOutcome };
