import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { brtStartOfDay, effectiveDailyCap } from '../utils/auto-dial-rules';
import { isRealConversation } from '../utils/real-conversation';
import { AUTO_DIAL_METADATA_KEY, countMotorCallsToday } from './cockpit-auto-dial.service';

/** Mesmas colunas que `isRealConversation` lê (desfecho do SDR, IA e telemetria). */
const CALL_COLUMNS =
  'id, created_at, started_at, answered_at, duration_seconds, status, sdr_disposition, metadata';

export interface AutoDialDayStats {
  /** Ligações do motor hoje (dia BRT), as mesmas do teto de 400. */
  callsToday: number;
  /** Conversas reais entre elas (desfecho do SDR, depois IA, depois conectada >= 50 s). */
  answeredToday: number;
  /** answered / calls em %, arredondado (0 sem ligações). */
  ratePct: number;
  dailyCap: number;
  remaining: number;
}

/**
 * Resumo do dia do motor para UM usuário. Só leitura. Conta as ligações com o marcador do motor pela mesma consulta
 * do teto (`countMotorCallsToday`) e lê essas ligações uma vez para decidir quais foram conversa real.
 * Service role ignora RLS: toda consulta filtra `org_id` e `user_id`. `null` = falha de leitura (nunca número parcial).
 */
export async function getAutoDialDayStats(
  client: SupabaseClient,
  orgId: string,
  userId: string,
  now: Date,
): Promise<AutoDialDayStats | null> {
  const callsToday = await countMotorCallsToday(client, orgId, userId, now);
  if (callsToday === null) return null;

  const dailyCap = effectiveDailyCap();
  let answeredToday = 0;
  if (callsToday > 0) {
    const since = new Date(brtStartOfDay(now)).toISOString();
    const { data, error } = (await from(client, 'calls')
      .select(CALL_COLUMNS)
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .gte('started_at', since)
      .not(`metadata->${AUTO_DIAL_METADATA_KEY}`, 'is', null)) as unknown as {
      data: Array<Parameters<typeof isRealConversation>[0]> | null;
      error: { message: string } | null;
    };
    if (error || !data) return null;
    answeredToday = Math.min(data.filter(isRealConversation).length, callsToday);
  }
  const ratePct = callsToday === 0 ? 0 : Math.round((answeredToday / callsToday) * 100);
  return {
    callsToday,
    answeredToday,
    ratePct,
    dailyCap,
    remaining: Math.max(0, dailyCap - callsToday),
  };
}
