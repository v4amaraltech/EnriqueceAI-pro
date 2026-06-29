// Saúde de um número WhatsApp (story 7.9). Função PURA — testável sem DB.
// Classifica a partir do volume e da taxa de not_connected nas últimas 24h:
//   - 'limit'    : atingiu o teto diário (bloqueia novas chamadas)
//   - 'degraded' : taxa de not_connected alta (proxy de throttle/ban) → alerta
//   - 'healthy'  : operando normal
import { DAILY_CALL_LIMIT, HEALTH_MIN_SAMPLE, NOT_CONNECTED_ALERT_RATE } from './constants';

export type NumberHealth = 'healthy' | 'degraded' | 'limit';

export interface NumberUsage {
  callsLast24h: number;
  notConnectedLast24h: number;
  notConnectedRate: number; // 0..1
  health: NumberHealth;
  limit: number;
}

export function computeNumberHealth(callsLast24h: number, notConnectedLast24h: number): NumberUsage {
  const notConnectedRate = callsLast24h > 0 ? notConnectedLast24h / callsLast24h : 0;

  let health: NumberHealth = 'healthy';
  if (callsLast24h >= DAILY_CALL_LIMIT) {
    health = 'limit';
  } else if (callsLast24h >= HEALTH_MIN_SAMPLE && notConnectedRate >= NOT_CONNECTED_ALERT_RATE) {
    health = 'degraded';
  }

  return {
    callsLast24h,
    notConnectedLast24h,
    notConnectedRate,
    health,
    limit: DAILY_CALL_LIMIT,
  };
}
