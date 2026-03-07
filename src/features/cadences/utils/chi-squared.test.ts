import { describe, expect, it } from 'vitest';

import { chiSquaredTest } from './chi-squared';

describe('chiSquaredTest', () => {
  it('returns null when either total is zero', () => {
    expect(chiSquaredTest(10, 0, 5, 100)).toBeNull();
    expect(chiSquaredTest(10, 100, 5, 0)).toBeNull();
  });

  it('returns null when all successes or all failures', () => {
    expect(chiSquaredTest(0, 100, 0, 100)).toBeNull();
    expect(chiSquaredTest(100, 100, 100, 100)).toBeNull();
  });

  it('returns null when expected values are too small', () => {
    expect(chiSquaredTest(1, 2, 0, 2)).toBeNull();
  });

  it('detects no significant difference with similar rates', () => {
    // A: 20/100 (20%), B: 22/100 (22%)
    const result = chiSquaredTest(20, 100, 22, 100);
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeGreaterThan(0.05);
  });

  it('detects significant difference with large effect', () => {
    // A: 10/100 (10%), B: 30/100 (30%)
    const result = chiSquaredTest(10, 100, 30, 100);
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeLessThan(0.05);
    expect(result!.chiSquared).toBeGreaterThan(0);
  });

  it('returns high p-value for identical rates', () => {
    // A: 25/100, B: 25/100
    const result = chiSquaredTest(25, 100, 25, 100);
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeGreaterThan(0.5);
  });

  it('handles asymmetric sample sizes', () => {
    // A: 50/500 (10%), B: 30/100 (30%)
    const result = chiSquaredTest(50, 500, 30, 100);
    expect(result).not.toBeNull();
    expect(result!.pValue).toBeLessThan(0.05);
  });

  it('returns values in expected range', () => {
    const result = chiSquaredTest(15, 80, 25, 80);
    expect(result).not.toBeNull();
    expect(result!.chiSquared).toBeGreaterThanOrEqual(0);
    expect(result!.pValue).toBeGreaterThanOrEqual(0);
    expect(result!.pValue).toBeLessThanOrEqual(1);
  });
});
