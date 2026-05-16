import type { CallStatus } from '@/features/calls/types';

/**
 * Centralized chart color palette for statistics and data visualizations.
 * All chart components should import colors from here instead of hardcoding hex values.
 */

/** Semantic channel colors for activity/interaction charts */
export const CHANNEL_COLORS: Record<string, string> = {
  email: '#3b82f6',
  whatsapp: '#22c55e',
  phone: '#8b5cf6',
  linkedin: '#0ea5e9',
  research: '#f59e0b',
};

/** Semantic channel labels (pt-BR) */
export const CHANNEL_LABELS: Record<string, string> = {
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Telefone',
  linkedin: 'LinkedIn',
  research: 'Pesquisa',
};

/** Interaction type colors for activity charts */
export const INTERACTION_TYPE_COLORS: Record<string, string> = {
  sent: '#3b82f6',
  delivered: '#06b6d4',
  opened: '#8b5cf6',
  clicked: '#ec4899',
  replied: '#22c55e',
  bounced: '#ef4444',
  meeting_scheduled: '#f59e0b',
  failed: '#6b7280',
};

/** Interaction type labels (pt-BR) */
export const INTERACTION_TYPE_LABELS: Record<string, string> = {
  sent: 'Enviadas',
  delivered: 'Entregues',
  opened: 'Abertas',
  clicked: 'Clicadas',
  replied: 'Respondidas',
  bounced: 'Bounced',
  meeting_scheduled: 'Reuniões',
  failed: 'Falharam',
};

/** Call status colors */
export const CALL_STATUS_COLORS: Record<CallStatus, string> = {
  significant: '#22c55e',
  not_significant: '#6b7280',
  no_contact: '#eab308',
  busy: '#f97316',
  not_connected: '#ef4444',
};

/** Call status labels (pt-BR) */
export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  significant: 'Significativa',
  not_significant: 'Não Significativa',
  no_contact: 'Sem Contato',
  busy: 'Ocupado',
  not_connected: 'Não Conectada',
};

/** Rotating color palette for multi-series charts (SDR comparison, etc.) */
export const CHART_SERIES_COLORS = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#f97316',
] as const;

/** Conversion funnel stage colors */
export const CONVERSION_COLORS = {
  totalLeads: '#6366f1',
  contacted: '#3b82f6',
  replied: '#8b5cf6',
  meeting: '#f59e0b',
  qualified: '#22c55e',
  sal: '#ef4444',
} as const;

/** Semantic single-use chart colors */
export const CHART_ACCENT = {
  connectionRate: '#22c55e',
  duration: '#8b5cf6',
  targetLine: '#ef4444',
  peakHighlight: '#f97316',
} as const;

/** Enrollment status colors for cadence/loss analytics */
export const ENROLLMENT_STATUS_COLORS: Record<string, string> = {
  active: '#3b82f6',
  paused: '#f59e0b',
  completed: '#22c55e',
  replied: '#8b5cf6',
  bounced: '#ef4444',
  unsubscribed: '#6b7280',
};

/** Enrollment status labels (pt-BR) */
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  paused: 'Pausado',
  completed: 'Concluído',
  replied: 'Respondido',
  bounced: 'Bounced',
  unsubscribed: 'Cancelado',
};

/** Fallback color when a key is not found in any color map */
export const CHART_FALLBACK_COLOR = '#6b7280';
