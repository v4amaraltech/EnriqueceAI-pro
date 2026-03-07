/**
 * Chi-squared test for 2x2 contingency tables (A/B testing).
 *
 * Tests whether conversion rates differ significantly between two variants.
 * Uses Yates' continuity correction for small sample sizes.
 */

/**
 * Approximate the upper-tail probability (1 - CDF) of the chi-squared
 * distribution with 1 degree of freedom using the Abramowitz & Stegun
 * approximation for the standard normal CDF.
 */
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327; // 1 / sqrt(2*pi)
  const p =
    d *
    Math.exp((-x * x) / 2) *
    t *
    (0.319381530 +
      t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

function chiSquaredPValue(chiSq: number): number {
  if (chiSq <= 0) return 1;
  const z = Math.sqrt(chiSq);
  return 2 * (1 - normalCdf(z));
}

export interface ChiSquaredResult {
  chiSquared: number;
  pValue: number;
}

/**
 * Performs a chi-squared test comparing two proportions.
 *
 * @param aSuccess - Number of successes in variant A
 * @param aTotal   - Total observations in variant A
 * @param bSuccess - Number of successes in variant B
 * @param bTotal   - Total observations in variant B
 * @returns Chi-squared statistic and p-value, or null if insufficient data
 */
export function chiSquaredTest(
  aSuccess: number,
  aTotal: number,
  bSuccess: number,
  bTotal: number,
): ChiSquaredResult | null {
  if (aTotal === 0 || bTotal === 0) return null;

  const n = aTotal + bTotal;
  const totalSuccess = aSuccess + bSuccess;
  const totalFailure = n - totalSuccess;

  if (totalSuccess === 0 || totalFailure === 0) return null;

  // Expected values for 2x2 table
  const eA1 = (aTotal * totalSuccess) / n;
  const eA0 = (aTotal * totalFailure) / n;
  const eB1 = (bTotal * totalSuccess) / n;
  const eB0 = (bTotal * totalFailure) / n;

  // Skip if any expected value is too small
  if (eA1 < 1 || eA0 < 1 || eB1 < 1 || eB0 < 1) return null;

  const aFailure = aTotal - aSuccess;
  const bFailure = bTotal - bSuccess;

  // Chi-squared with Yates' continuity correction
  const cells = [
    { observed: aSuccess, expected: eA1 },
    { observed: aFailure, expected: eA0 },
    { observed: bSuccess, expected: eB1 },
    { observed: bFailure, expected: eB0 },
  ];

  let chiSq = 0;
  for (const { observed, expected } of cells) {
    const diff = Math.abs(observed - expected) - 0.5; // Yates' correction
    chiSq += (diff * diff) / expected;
  }

  const pValue = chiSquaredPValue(chiSq);

  return { chiSquared: Math.round(chiSq * 1000) / 1000, pValue: Math.round(pValue * 10000) / 10000 };
}
