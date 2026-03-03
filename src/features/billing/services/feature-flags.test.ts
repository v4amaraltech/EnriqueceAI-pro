import { describe, expect, it } from 'vitest';

import type { PlanFeatures, PlanRow } from '../types';

import {
  calculateMonthlyTotal,
  calculateUsageLimits,
  checkFeature,
  formatCents,
  getPlanDiff,
  isNearLimit,
} from './feature-flags';

function makePlan(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    id: 'plan-1',
    name: 'Pro',
    slug: 'pro',
    price_cents: 34900,
    max_leads: 5000,
    max_ai_per_day: 100,
    max_whatsapp_per_month: 2000,
    included_users: 5,
    additional_user_price_cents: 8900,
    features: { enrichment: 'lemit', crm: true, calendar: true },
    active: true,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    ...overrides,
  };
}

describe('checkFeature', () => {
  it('returns true for boolean true features', () => {
    const features: PlanFeatures = { enrichment: 'basic', crm: true, calendar: false };
    expect(checkFeature(features, 'crm')).toBe(true);
  });

  it('returns false for boolean false features', () => {
    const features: PlanFeatures = { enrichment: 'basic', crm: false, calendar: false };
    expect(checkFeature(features, 'calendar')).toBe(false);
  });

  it('returns false for basic enrichment', () => {
    const features: PlanFeatures = { enrichment: 'basic', crm: false, calendar: false };
    expect(checkFeature(features, 'enrichment')).toBe(false);
  });

  it('returns true for non-basic enrichment', () => {
    const features: PlanFeatures = { enrichment: 'lemit', crm: false, calendar: false };
    expect(checkFeature(features, 'enrichment')).toBe(true);
  });
});

describe('calculateUsageLimits', () => {
  it('calculates limits correctly within plan', () => {
    const plan = makePlan();
    const limits = calculateUsageLimits(plan, 1000, 50, 500, 3);

    expect(limits.leads).toEqual({ current: 1000, max: 5000, exceeded: false });
    expect(limits.aiPerDay).toEqual({ current: 50, max: 100, exceeded: false, unlimited: false });
    expect(limits.whatsappPerMonth).toEqual({ current: 500, max: 2000, exceeded: false });
    expect(limits.users).toEqual({ current: 3, included: 5, additional: 0 });
  });

  it('flags exceeded limits', () => {
    const plan = makePlan();
    const limits = calculateUsageLimits(plan, 5000, 100, 2000, 7);

    expect(limits.leads.exceeded).toBe(true);
    expect(limits.aiPerDay.exceeded).toBe(true);
    expect(limits.whatsappPerMonth.exceeded).toBe(true);
    expect(limits.users.additional).toBe(2);
  });

  it('handles unlimited AI', () => {
    const plan = makePlan({ max_ai_per_day: -1 });
    const limits = calculateUsageLimits(plan, 100, 9999, 100, 1);

    expect(limits.aiPerDay.unlimited).toBe(true);
    expect(limits.aiPerDay.exceeded).toBe(false);
  });
});

describe('calculateMonthlyTotal', () => {
  it('returns base price when within included users', () => {
    const plan = makePlan({ price_cents: 34900, included_users: 5, additional_user_price_cents: 8900 });
    expect(calculateMonthlyTotal(plan, 3)).toBe(34900);
  });

  it('adds cost for additional users', () => {
    const plan = makePlan({ price_cents: 34900, included_users: 5, additional_user_price_cents: 8900 });
    expect(calculateMonthlyTotal(plan, 7)).toBe(34900 + 2 * 8900);
  });

  it('handles exactly included users', () => {
    const plan = makePlan({ price_cents: 14900, included_users: 3, additional_user_price_cents: 4900 });
    expect(calculateMonthlyTotal(plan, 3)).toBe(14900);
  });
});

describe('isNearLimit', () => {
  it('returns true when at or above threshold', () => {
    expect(isNearLimit(80, 100)).toBe(true);
    expect(isNearLimit(90, 100)).toBe(true);
  });

  it('returns false when below threshold', () => {
    expect(isNearLimit(50, 100)).toBe(false);
    expect(isNearLimit(79, 100)).toBe(false);
  });

  it('returns false for max <= 0', () => {
    expect(isNearLimit(5, 0)).toBe(false);
    expect(isNearLimit(5, -1)).toBe(false);
  });

  it('supports custom threshold', () => {
    expect(isNearLimit(90, 100, 0.9)).toBe(true);
    expect(isNearLimit(89, 100, 0.9)).toBe(false);
  });
});

describe('formatCents', () => {
  it('formats cents to BRL currency', () => {
    const result = formatCents(34900);
    expect(result).toContain('349');
    expect(result).toContain('R$');
  });

  it('formats zero correctly', () => {
    const result = formatCents(0);
    expect(result).toContain('0');
    expect(result).toContain('R$');
  });
});

describe('getPlanDiff', () => {
  const starterPlan = makePlan({
    slug: 'starter',
    name: 'Starter',
    price_cents: 14900,
    max_leads: 1000,
    max_ai_per_day: 30,
    max_whatsapp_per_month: 500,
    included_users: 2,
    features: { enrichment: 'basic', crm: false, calendar: false },
  });

  const proPlan = makePlan({
    slug: 'pro',
    name: 'Pro',
    price_cents: 34900,
    max_leads: 5000,
    max_ai_per_day: 100,
    max_whatsapp_per_month: 2000,
    included_users: 5,
    features: { enrichment: 'lemit', crm: true, calendar: true },
  });

  const scalePlan = makePlan({
    slug: 'scale',
    name: 'Scale',
    price_cents: 69900,
    max_leads: 20000,
    max_ai_per_day: -1,
    max_whatsapp_per_month: 10000,
    included_users: 10,
    features: { enrichment: 'full', crm: true, calendar: true },
  });

  it('detects gained features on upgrade (starter → pro)', () => {
    const diff = getPlanDiff(starterPlan, proPlan);

    expect(diff.gained).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'CRM' }),
        expect.objectContaining({ name: 'Calendário' }),
        expect.objectContaining({ name: expect.stringContaining('Enriquecimento') }),
      ]),
    );
    expect(diff.lost).toHaveLength(0);
  });

  it('detects lost features on downgrade (pro → starter)', () => {
    const diff = getPlanDiff(proPlan, starterPlan);

    expect(diff.lost).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'CRM' }),
        expect.objectContaining({ name: 'Calendário' }),
        expect.objectContaining({ name: expect.stringContaining('Enriquecimento') }),
      ]),
    );
    expect(diff.gained).toHaveLength(0);
  });

  it('detects limit changes on upgrade', () => {
    const diff = getPlanDiff(starterPlan, proPlan);

    expect(diff.limitsChanged).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'Leads' }),
        expect.objectContaining({ name: 'IA por dia' }),
        expect.objectContaining({ name: 'WhatsApp/mês' }),
        expect.objectContaining({ name: 'Usuários inclusos' }),
      ]),
    );
  });

  it('returns empty diff for identical plans', () => {
    const diff = getPlanDiff(proPlan, proPlan);

    expect(diff.gained).toHaveLength(0);
    expect(diff.lost).toHaveLength(0);
    expect(diff.limitsChanged).toHaveLength(0);
  });

  it('handles unlimited AI diff correctly (pro → scale)', () => {
    const diff = getPlanDiff(proPlan, scalePlan);

    const aiChange = diff.limitsChanged.find((l) => l.name === 'IA por dia');
    expect(aiChange).toBeDefined();
    expect(aiChange!.to).toBe('Ilimitado');
  });

  it('detects enrichment upgrade without boolean feature changes (pro → scale)', () => {
    const diff = getPlanDiff(proPlan, scalePlan);

    expect(diff.gained).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: expect.stringContaining('Enriquecimento') }),
      ]),
    );
    // CRM and Calendar don't change (both already true)
    expect(diff.gained.find((g) => g.name === 'CRM')).toBeUndefined();
    expect(diff.gained.find((g) => g.name === 'Calendário')).toBeUndefined();
  });
});
