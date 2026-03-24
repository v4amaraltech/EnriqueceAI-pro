/**
 * Standardized error codes for ActionResult responses.
 *
 * Convention:
 * - SCREAMING_SNAKE_CASE
 * - Grouped by domain
 * - Used in `code` field of `{ success: false, error, code }`
 */

// --- Auth & Rate Limiting ---
export const ERR_RATE_LIMITED = 'RATE_LIMITED';
export const ERR_NOT_CONFIGURED = 'NOT_CONFIGURED';

// --- Resource Limits ---
export const ERR_LEAD_LIMIT_REACHED = 'LEAD_LIMIT_REACHED';
export const ERR_LEAD_LIMIT_EXCEEDED = 'LEAD_LIMIT_EXCEEDED';
export const ERR_MEMBER_LIMIT_REACHED = 'MEMBER_LIMIT_REACHED';

// --- Validation ---
export const ERR_INVALID_PARAMS = 'INVALID_PARAMS';
export const ERR_MISSING_LEAD_NAME = 'MISSING_LEAD_NAME';

// --- Idempotency ---
export const ERR_ALREADY_EXECUTED = 'ALREADY_EXECUTED';
