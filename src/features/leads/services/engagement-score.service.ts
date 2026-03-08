/**
 * Engagement Score Engine — calculates lead engagement temperature from interactions.
 * Pure function: no DB access, receives interaction data as input.
 * Mirrors the PostgreSQL calculate_engagement_score() function.
 */

export interface InteractionSignal {
  type: string;
  created_at: string; // ISO timestamp
}

const INTERACTION_WEIGHTS: Record<string, number> = {
  sent: 2,
  delivered: 3,
  opened: 5,
  clicked: 8,
  replied: 20,
  meeting_scheduled: 30,
  bounced: -10,
  failed: -5,
};

const DECAY_WINDOW_DAYS = 90;
const MIN_DECAY = 0.1;

/**
 * Calculate time decay factor for an interaction.
 * Returns a value between MIN_DECAY and 1.0.
 */
function decayFactor(createdAt: string, now: Date): number {
  const daysSince = (now.getTime() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24);
  return Math.max(MIN_DECAY, 1 - daysSince / DECAY_WINDOW_DAYS);
}

/**
 * Calculate the engagement score for a lead based on interaction signals.
 * Returns null if no interactions exist, otherwise 0-100.
 */
export function calculateEngagementScore(
  interactions: InteractionSignal[],
  now?: Date,
): number | null {
  if (interactions.length === 0) return null;

  const referenceDate = now ?? new Date();
  let score = 0;

  for (const interaction of interactions) {
    const weight = INTERACTION_WEIGHTS[interaction.type] ?? 0;
    const decay = decayFactor(interaction.created_at, referenceDate);
    score += weight * decay;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}
