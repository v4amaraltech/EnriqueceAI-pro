import type { CallDisposition, CallStatus } from '@/features/calls/types';

import type { FunnelStage } from './conversion-analytics.types';

export interface CallOutcomeBarEntry {
  status: CallStatus;
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface DurationBucket {
  label: string;
  range: string;
  count: number;
}

export interface HeatmapCell {
  dayOfWeek: number;
  dayLabel: string;
  hourBlock: number;
  hourLabel: string;
  count: number;
}

export interface SdrCallEntry {
  userId: string;
  userName: string;
  totalCalls: number;
  connectionRate: number;
}

export interface CallStatisticsKpis {
  totalCalls: number;
  totalDurationSeconds: number;
  avgDurationSeconds: number;
  bestDay: string;
  bestHour: string;
}

/** Contagens de efetividade — regras em `features/calls/effectiveness.ts`. */
export interface CallEffectivenessCounts {
  totalCalls: number;
  /** Telefonia confirmou conversa OU o SDR confirmou atendimento humano. */
  answeredCalls: number;
  /** SDR marcou "Conversa relevante". */
  relevantCalls: number;
  /** Passaram pelo discador do app — onde o SDR informa o desfecho (`isDialerCall`). */
  dialerCalls: number;
  /** Feitas fora do discador (Callface, softphone/Kommo, reconcile) — sem desfecho possível. */
  externalCalls: number;
  /** Ligações DO DISCADOR sem desfecho marcado — o que o SDR deixou de informar. */
  withoutDispositionCalls: number;
  /** Atendidas sem desfecho — não dá para saber se foram relevantes. */
  answeredWithoutDispositionCalls: number;
}

export interface CallEffectivenessSummary extends CallEffectivenessCounts {
  /** Regra canônica `isConnectedCall()` — mesma do Painel de Ligações e do BI. */
  connectedCalls: number;
  connectionRate: number;
  relevantRate: number;
  /** Sobre as ligações do discador (não sobre o total). */
  withoutDispositionRate: number;
  /** Alguma ligação do período teve `answered_at`? Se não, a telefonia está muda. */
  hasTelephonyAnswerSignal: boolean;
}

export interface SdrEffectivenessRow extends CallEffectivenessCounts {
  userId: string;
  userName: string;
  relevantRate: number;
  /** Sobre as ligações do discador do SDR. */
  withoutDispositionRate: number;
}

export interface DispositionBreakdownRow {
  /** `none` = feita no discador sem desfecho; `external` = feita fora do discador. */
  key: CallDisposition | 'none' | 'external';
  label: string;
  count: number;
  percentage: number;
}

export interface CallEffectivenessData {
  summary: CallEffectivenessSummary;
  funnel: FunnelStage[];
  /**
   * Desfecho marcado pelo SDR — todas as opções + "Sem desfecho (discador)" +
   * "Feita fora do discador", sempre na mesma ordem; soma = total.
   */
  dispositions: DispositionBreakdownRow[];
  bySdr: SdrEffectivenessRow[];
}

export interface CallStatisticsData {
  /** Período passou do teto de segurança de leitura — números parciais. */
  isTruncated: boolean;
  kpis: CallStatisticsKpis;
  effectiveness: CallEffectivenessData;
  durationDistribution: DurationBucket[];
  heatmap: HeatmapCell[];
  callsBySdr: SdrCallEntry[];
}
