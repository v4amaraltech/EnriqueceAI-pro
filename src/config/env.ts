import { z } from 'zod';

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  HUBSPOT_CLIENT_ID: z.string().min(1).optional(),
  HUBSPOT_CLIENT_SECRET: z.string().min(1).optional(),
  PIPEDRIVE_CLIENT_ID: z.string().min(1).optional(),
  PIPEDRIVE_CLIENT_SECRET: z.string().min(1).optional(),
  GCAL_CLIENT_ID: z.string().min(1).optional(),
  GCAL_CLIENT_SECRET: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16, 'CRON_SECRET must be at least 16 characters'),
  SENTRY_DSN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().optional(),
  LEMIT_API_URL: z.string().url().optional(),
  LEMIT_API_TOKEN: z.string().min(1).optional(),
  APOLLO_API_KEY: z.string().min(1).optional(),
  TOKEN_ENCRYPTION_KEY: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/i)
    .optional(),
  EVOLUTION_API_URL: z.string().url().optional(),
  EVOLUTION_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  // T3: Previously unvalidated env vars (used via process.env directly)
  KOMMO_CLIENT_ID: z.string().min(1).optional(),
  KOMMO_CLIENT_SECRET: z.string().min(1).optional(),
  RDSTATION_CLIENT_ID: z.string().min(1).optional(),
  RDSTATION_CLIENT_SECRET: z.string().min(1).optional(),
  API4COM_WEBHOOK_SECRET: z.string().min(1).optional(),
  // BRL per-minute rate used to compute calls.cost. Mobile and landline are
  // billed differently by API4COM, so each has its own env var. When either
  // is unset, the matching call's cost stays NULL (no fake zeros).
  API4COM_PRICE_PER_MIN_MOBILE_BRL: z.coerce.number().nonnegative().optional(),
  API4COM_PRICE_PER_MIN_LANDLINE_BRL: z.coerce.number().nonnegative().optional(),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1).optional(),
  WHATSAPP_APP_SECRET: z.string().min(1).optional(),
  APOLLO_WEBHOOK_SECRET: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  // WhatsApp-native dialer voice microservice (Epic 7). Server-only — the API
  // key is never exposed to the browser; all calls go through Server Actions.
  WACALLS_BASE_URL: z.string().url().optional(),
  WACALLS_API_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

export function getEnv(): Env {
  if (!_env) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
      throw new Error('Invalid environment variables');
    }
    _env = parsed.data;
  }
  return _env;
}
