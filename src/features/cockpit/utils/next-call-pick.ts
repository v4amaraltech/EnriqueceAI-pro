import type { RankedLead } from '@/features/contact-engine/services/call-priority';

export interface ColdCandidate {
  leadId: string;
  /** Posição do lead na ordem do frio calculada no banco (1 = primeiro). */
  coldRank: number;
}

export type CockpitTier = 'hot' | 'cold';

/**
 * Escolhe o lead do cartão. PURA e determinística.
 *  - Existe quente confirmado (interesse > 0, já ordenado por `rankLeadsByPriority`): o primeiro.
 *  - Senão: o de menor `coldRank` (empate por leadId, para resultado estável).
 *  - Nada: null.
 */
export function pickCockpitLead(input: { hot: RankedLead[]; cold: ColdCandidate[] }): { leadId: string; tier: CockpitTier } | null {
  const hot = input.hot.find((h) => h.result.interest > 0);
  if (hot) return { leadId: hot.leadId, tier: 'hot' };
  const cold = [...input.cold].sort((a, b) => a.coldRank - b.coldRank || a.leadId.localeCompare(b.leadId))[0];
  return cold ? { leadId: cold.leadId, tier: 'cold' } : null;
}
