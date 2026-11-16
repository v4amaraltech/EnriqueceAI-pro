/**
 * 424 (ramal ocupado na operadora): nova tentativa a cada 5 s por até 1 min e depois pausa com o motivo
 * (A-D11, altera o FR-15). Cópia PRÓPRIA do Cockpit da ideia de `nextRamalAttempt` da Execução (que espera até 15 s e
 * tenta uma vez): a regra do motor é decisão do usuário e não pode mudar se a Execução mudar. PURA.
 */
export const RAMAL_BUSY_RETRY_INTERVAL_MS = 5_000;
export const RAMAL_BUSY_MAX_TOTAL_MS = 60_000;

export type RamalBusyStep =
  | { action: 'wait'; waitMs: number; firstBusyAt: number }
  | { action: 'pause'; firstBusyAt: number };

/** `firstBusyAt` = quando o 424 apareceu pela primeira vez nesta sequência (null = é o primeiro). */
export function nextRamalBusyStep(input: { firstBusyAt: number | null; now: number }): RamalBusyStep {
  const firstBusyAt = input.firstBusyAt ?? input.now;
  if (input.now - firstBusyAt >= RAMAL_BUSY_MAX_TOTAL_MS) return { action: 'pause', firstBusyAt };
  return { action: 'wait', waitMs: RAMAL_BUSY_RETRY_INTERVAL_MS, firstBusyAt };
}
