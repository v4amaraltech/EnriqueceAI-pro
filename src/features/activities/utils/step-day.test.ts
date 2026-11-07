import { describe, expect, it } from 'vitest';

import { cadenceStepDay } from './step-day';

const steps = [
  { step_order: 1, delay_days: 0 },
  { step_order: 2, delay_days: 0 },
  { step_order: 3, delay_days: 1 },
  { step_order: 4, delay_days: 2 },
];

describe('cadenceStepDay', () => {
  it('passos sem atraso ficam no dia 1', () => {
    expect(cadenceStepDay(steps, 1)).toBe(1);
    expect(cadenceStepDay(steps, 2)).toBe(1);
  });

  it('soma os atrasos acumulados até o passo', () => {
    expect(cadenceStepDay(steps, 3)).toBe(2);
    expect(cadenceStepDay(steps, 4)).toBe(4);
  });

  it('não depende da ordem do array nem de atraso negativo', () => {
    const shuffled = [steps[3]!, steps[0]!, { step_order: 2, delay_days: -5 }, steps[2]!];
    expect(cadenceStepDay(shuffled, 4)).toBe(4);
  });
});
