/** Passo de cadência com o atraso configurado em relação ao passo anterior. */
export interface StepDelay {
  step_order: number;
  delay_days: number;
}

/**
 * Dia da cadência em que um passo cai: dia 1 + soma dos `delay_days` dos passos
 * até ele (inclusive). Ex.: passos com atraso 0, 0, 1, 2 → dias 1, 1, 2, 4.
 * Só conta dias inteiros (`delay_hours` não muda o dia exibido).
 */
export function cadenceStepDay(steps: StepDelay[], stepOrder: number): number {
  let days = 0;
  for (const s of steps) {
    if (s.step_order <= stepOrder) days += Math.max(0, s.delay_days ?? 0);
  }
  return days + 1;
}
