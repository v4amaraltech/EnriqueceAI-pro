'use server';

import type { ActionResult } from '@/lib/actions/action-result';

import type { DialerStats } from '../schemas/dialer-preferences.schemas';

import { fetchDialerQueueWithStats } from './fetch-dialer-queue';

/**
 * Números do card "Leads fora da fila". Vêm da MESMA montagem da fila do Power
 * Dialer (`fetchDialerQueueWithStats`), para o card nunca contar com outra
 * regra. Quem já carrega a fila deve usar `fetchDialerQueueWithStats` direto e
 * evitar consultar duas vezes.
 */
export async function fetchDialerStats(): Promise<ActionResult<DialerStats>> {
  const result = await fetchDialerQueueWithStats();
  if (!result.success) {
    return {
      success: true,
      data: { leadsWithoutPhone: 0, leadsAtDailyLimit: 0, leadsWithSnooze: 0, totalAvailable: 0 },
    };
  }
  return { success: true, data: result.data.stats };
}
