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
  /** Nenhum desfecho marcado pelo SDR. */
  withoutDispositionCalls: number;
  /** Atendidas sem desfecho — não dá para saber se foram relevantes. */
  answeredWithoutDispositionCalls: number;
}

export interface CallEffectivenessSummary extends CallEffectivenessCounts {
  /** Regra canônica `isConnectedCall()` — mesma do Painel de Ligações e do BI. */
  connectedCalls: number;
  connectionRate: number;
  relevantRate: number;
  withoutDispositionRate: number;
  /** Alguma ligação do período teve `answered_at`? Se não, a telefonia está muda. */
  hasTelephonyAnswerSignal: boolean;
}

export interface SdrEffectivenessRow extends CallEffectivenessCounts {
  userId: string;
  userName: string;
  relevantRate: number;
  withoutDispositionRate: number;
}

export interface DispositionBreakdownRow {
  /** `null` = sem desfecho marcado. */
  disposition: CallDisposition | null;
  label: string;
  count: number;
  percentage: number;
}

export interface CallEffectivenessData {
  summary: CallEffectivenessSummary;
  funnel: FunnelStage[];
  /** Desfecho marcado pelo SDR — todas as opções + "Sem desfecho", sempre na mesma ordem. */
  dispositions: DispositionBreakdownRow[];
  bySdr: SdrEffectivenessRow[];
}

export interface CallStatisticsData {
  kpis: CallStatisticsKpis;
  effectiveness: CallEffectivenessData;
  durationDistribution: DurationBucket[];
  heatmap: HeatmapCell[];
  callsBySdr: SdrCallEntry[];
}
