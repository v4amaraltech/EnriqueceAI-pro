/** Etapas da carteira do SDR (regra em `cockpit_lead_stages`, migration 20261107032423). */
export const LEAD_STAGES = [
  { key: 'desqualificado', label: 'Desqualificado' },
  { key: 'entrada', label: 'Entrada' },
  { key: 'tentativa', label: 'Tentativa de conexão' },
  { key: 'conexao', label: 'Conexão estabelecida' },
  { key: 'sql', label: 'Reunião agendada (SQL)' },
  { key: 'no_show', label: 'No Show' },
  { key: 'sal', label: 'Reunião realizada (SAL)' },
] as const;

export type LeadStageKey = (typeof LEAD_STAGES)[number]['key'];

export function leadStageLabel(stage: string | null | undefined): string {
  return LEAD_STAGES.find((s) => s.key === stage)?.label ?? '—';
}

export type LeadTemperature = 'quente' | 'morno' | 'frio';

const DAY_MS = 24 * 60 * 60 * 1000;
export const HOT_WINDOW_DAYS = 7;
export const WARM_WINDOW_DAYS = 21;

/**
 * Temperatura do lead:
 * - Quente: respondeu ou teve reunião marcada nos últimos 7 dias;
 * - Morno: teve qualquer interação nos últimos 21 dias;
 * - Frio: o resto.
 */
export function leadTemperature(input: {
  now: Date;
  lastReplyAt: string | null;
  lastInteractionAt: string | null;
  meetingScheduledAt: string | null;
}): LeadTemperature {
  const age = (iso: string | null) => (iso ? input.now.getTime() - new Date(iso).getTime() : Infinity);
  if (age(input.lastReplyAt) <= HOT_WINDOW_DAYS * DAY_MS) return 'quente';
  if (age(input.meetingScheduledAt) <= HOT_WINDOW_DAYS * DAY_MS) return 'quente';
  if (age(input.lastInteractionAt) <= WARM_WINDOW_DAYS * DAY_MS) return 'morno';
  return 'frio';
}

/**
 * Tier V4 a partir do faturamento anual em reais — cópia fiel de
 * `calculate_tier_from_faturamento` (migration 20260512220000).
 */
export function tierFromFaturamento(reais: number | null | undefined): string | null {
  if (reais == null || Number.isNaN(reais)) return null;
  if (reais <= 50_000) return 'Não ICP';
  if (reais <= 100_000) return 'Tiny';
  if (reais <= 200_000) return 'Small';
  if (reais <= 4_000_000) return 'Medium';
  if (reais <= 40_000_000) return 'Large';
  return 'Enterprise';
}

/** Tier gravado pelo trigger (campo `tier_output`) ou, sem ele, calculado do faturamento. */
export function leadTier(storedTier: string | null | undefined, faturamento: number | null | undefined): string | null {
  const stored = storedTier?.trim();
  return stored ? stored : tierFromFaturamento(faturamento);
}
