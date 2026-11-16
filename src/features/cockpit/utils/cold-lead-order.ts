import { INTEREST_DISPOSITIONS } from '@/features/contact-engine/services/call-priority';
import { BANT_CORE_FIELDS, SIGNAL_WINDOW_DAYS } from '@/features/contact-engine/services/call-priority.service';

import type { CockpitViewer } from '../types';

/** Premissas da ordem do lead frio (spec cockpit-lead-frio, seção 10). */
export const COLD_ORDER_DEFAULTS = {
  /** DP-1: teto de ligações por lead por dia, só para o frio. 0 = sem teto. */
  dailyCap: 2,
  /** DP-1: janela de "tentativas recentes". */
  recentDays: 7,
  /** DP-2: janela de contagem de tentativas. */
  attemptsWindowDays: 30,
  /** DP-2: acima disto o lead desce para o fim dos frios. */
  maxAttempts: 6,
  /** Quantos frios a consulta devolve. */
  coldLimit: 20,
} as const;

/** DP-4. */
export const COLD_LEAD_LABEL = 'Sem leads quentes, mostrando frio';

/** Tamanho do bloco ao carregar sinais dos possíveis quentes (evita URL grande no PostgREST). */
export const SIGNAL_CHUNK_SIZE = 100;

export interface CockpitCandidatesRpcArgs {
  p_org_id: string;
  p_target_user_id: string;
  p_interest_dispositions: string[];
  p_bant_field_names: string[];
  p_exclude_lead_ids: string[];
  p_now: string;
  p_signal_window_days: number;
  p_recent_days: number;
  p_attempts_window_days: number;
  p_max_attempts: number;
  p_daily_cap: number;
  p_cold_limit: number;
}

/** Parâmetros da RPC que o chamador pode trocar. Sem eles valem os padrões acima (Cockpit manual do #641). */
export type CandidatesRpcOverrides = Partial<{
  dailyCap: number;
  coldLimit: number;
  recentDays: number;
  attemptsWindowDays: number;
  maxAttempts: number;
}>;

/**
 * Motor automático (plano §1, opção A): teto de 3 ligações por lead/dia e `cold_limit` acima da maior
 * carteira (533), chamando a RPC existente. O filtro de 1 h e o dos bloqueios `prospeccao` são feitos no TypeScript.
 */
export const AUTO_DIAL_RPC_OVERRIDES: CandidatesRpcOverrides = { dailyCap: 3, coldLimit: 1000 };

/** Argumentos da RPC `cockpit_next_call_candidates`. Pura: o relógio vem de fora (`now`). */
export function buildCandidatesRpcArgs(
  viewer: Pick<CockpitViewer, 'orgId' | 'targetUserId'>,
  now: Date,
  excludeLeadIds: string[] = [],
  overrides: CandidatesRpcOverrides = {},
): CockpitCandidatesRpcArgs {
  const o = { ...COLD_ORDER_DEFAULTS, ...overrides };
  return {
    p_org_id: viewer.orgId,
    p_target_user_id: viewer.targetUserId,
    p_interest_dispositions: [...INTEREST_DISPOSITIONS],
    p_bant_field_names: [...BANT_CORE_FIELDS],
    p_exclude_lead_ids: [...new Set(excludeLeadIds)],
    p_now: now.toISOString(),
    p_signal_window_days: SIGNAL_WINDOW_DAYS,
    p_recent_days: o.recentDays,
    p_attempts_window_days: o.attemptsWindowDays,
    p_max_attempts: o.maxAttempts,
    p_daily_cap: o.dailyCap,
    p_cold_limit: o.coldLimit,
  };
}

/** Divide em blocos de até `size` itens. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
