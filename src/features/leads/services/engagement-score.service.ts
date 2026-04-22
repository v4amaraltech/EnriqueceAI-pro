/**
 * Engagement Score Engine — calculates lead engagement temperature from interactions.
 * Pure function: no DB access, receives interaction data as input.
 * Mirrors the PostgreSQL calculate_engagement_score() function.
 *
 * Weights vary by channel to reflect actual engagement effort:
 * - Phone calls and WhatsApp are high-effort, personal channels
 * - Email is medium-effort, scalable
 * - LinkedIn and research are low-effort preparation
 */

export interface InteractionSignal {
  type: string;
  channel?: string;
  created_at: string; // ISO timestamp
}

/** Default weights by interaction type (email/unknown channel) */
const BASE_WEIGHTS: Record<string, number> = {
  sent: 2,
  delivered: 3,
  opened: 5,
  clicked: 10,
  replied: 25,
  meeting_scheduled: 30,
  bounced: -10,
  failed: -5,
};

/** Channel-specific overrides for 'sent' type (the most common) */
const CHANNEL_SENT_WEIGHTS: Record<string, number> = {
  phone: 5,
  whatsapp: 4,
  linkedin: 3,
  research: 1,
  email: 2,
  system: 0, // system events don't count as engagement
};

/** Channel-specific overrides for 'replied' type */
const CHANNEL_REPLIED_WEIGHTS: Record<string, number> = {
  whatsapp: 20,
  email: 25,
};

/** Channel-specific overrides for 'failed' type */
const CHANNEL_FAILED_WEIGHTS: Record<string, number> = {
  whatsapp: -3,
  email: -5,
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
 * Get the weight for an interaction based on type + channel.
 * Channel-specific overrides take precedence over base weights.
 */
function getWeight(type: string, channel?: string): number {
  if (type === 'sent' && channel) {
    return CHANNEL_SENT_WEIGHTS[channel] ?? BASE_WEIGHTS.sent ?? 0;
  }
  if (type === 'replied' && channel) {
    return CHANNEL_REPLIED_WEIGHTS[channel] ?? BASE_WEIGHTS.replied ?? 0;
  }
  if (type === 'failed' && channel) {
    return CHANNEL_FAILED_WEIGHTS[channel] ?? BASE_WEIGHTS.failed ?? 0;
  }
  return BASE_WEIGHTS[type] ?? 0;
}

/**
 * Calculate the engagement score for a lead based on interaction signals.
 * Returns null if no interactions exist, otherwise 0-100.
 *
 * NOTE: The PostgreSQL function (calculate_engagement_score) handles an edge case
 * this TS version cannot: when a lead has old interactions (>90 days) but none recent,
 * SQL returns 0 while this function would return null (since it only receives the
 * interactions array without knowledge of older ones). The authoritative score always
 * comes from the SQL function via recalc_engagement_score(). This TS version exists
 * for client-side preview and testing parity only.
 */
export function calculateEngagementScore(
  interactions: InteractionSignal[],
  now?: Date,
): number | null {
  if (interactions.length === 0) return null;

  const referenceDate = now ?? new Date();
  let score = 0;

  for (const interaction of interactions) {
    const weight = getWeight(interaction.type, interaction.channel);
    const decay = decayFactor(interaction.created_at, referenceDate);
    score += weight * decay;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}
