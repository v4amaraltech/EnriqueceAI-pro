// --- File Upload Limits ---
export const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
export const MAX_CSV_SIZE = 10 * 1024 * 1024; // 10 MB
export const MAX_APOLLO_IMPORT = 100;

// --- Pagination ---
export const DEFAULT_PAGE_SIZE = 100;

// --- Auth Rate Limits ---
export const LOGIN_LIMIT = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const SIGNUP_LIMIT = 3;
export const SIGNUP_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RESET_LIMIT = 3;
export const RESET_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RESEND_LIMIT = 2;
export const RESEND_WINDOW_MS = 5 * 60 * 1000; // 5 min

// --- Tracking Rate Limits ---
export const TRACKING_LIMIT = 100;
export const TRACKING_WINDOW_MS = 60_000; // 1 min

// --- Business ---
export const INVITE_EXPIRY_DAYS = 7;
export const RESOURCE_ALERT_THRESHOLD = 0.8; // 80% usage triggers alert
