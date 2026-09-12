import { describe, expect, it } from 'vitest';

import { saveGoalsSchema } from './goals.schema';

describe('saveGoalsSchema', () => {
  const validInput = {
    month: '2026-02',
    leadsFinishedTarget: 100,
    activitiesTarget: 200,
    conversionTarget: 25,
    leadsOpenedTarget: 150,
    meetingsScheduledTarget: 100,
    meetingsHeldTarget: 80,
    userGoals: [{ userId: '00000000-0000-0000-0000-000000000001', opportunityTarget: 10 }],
  };

  it('accepts valid input', () => {
    expect(saveGoalsSchema.safeParse(validInput).success).toBe(true);
  });

  it('rejects invalid month format', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, month: '2026-2' });
    expect(result.success).toBe(false);
  });

  it('rejects negative meetings held target', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, meetingsHeldTarget: -1 });
    expect(result.success).toBe(false);
  });

  it('meta de SAO é opcional com default 0 (deployment skew) e rejeita negativo', () => {
    const withoutSao = saveGoalsSchema.safeParse(validInput);
    expect(withoutSao.success).toBe(true);
    if (withoutSao.success) {
      expect(withoutSao.data.saoTarget).toBe(0);
      expect(withoutSao.data.userGoals[0]?.saoTarget).toBe(0);
    }
    const negative = saveGoalsSchema.safeParse({ ...validInput, saoTarget: -1 });
    expect(negative.success).toBe(false);
  });

  it('rejects conversion target above 100', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, conversionTarget: 101 });
    expect(result.success).toBe(false);
  });

  it('rejects conversion target below 0', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, conversionTarget: -5 });
    expect(result.success).toBe(false);
  });

  it('rejects empty userGoals array', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, userGoals: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid userId in userGoals', () => {
    const result = saveGoalsSchema.safeParse({
      ...validInput,
      userGoals: [{ userId: 'not-a-uuid', opportunityTarget: 10 }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts zero values', () => {
    const result = saveGoalsSchema.safeParse({
      ...validInput,
      meetingsHeldTarget: 0,
      conversionTarget: 0,
    });
    expect(result.success).toBe(true);
  });

  it('accepts boundary conversion target of 100', () => {
    const result = saveGoalsSchema.safeParse({ ...validInput, conversionTarget: 100 });
    expect(result.success).toBe(true);
  });
});
