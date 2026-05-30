import '@testing-library/jest-dom/vitest';

import { vi } from 'vitest';

// ──────────────────────────────────────────────────────────────
// Test environment variables
// ──────────────────────────────────────────────────────────────
// Injected so modules that read Supabase env at call-time (e.g.
// createServiceRoleClient in src/lib/supabase/service.ts) don't throw
// "Missing SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL" during tests.
// These are dummy values — the Supabase client itself is always mocked.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key';
process.env.NEXT_PUBLIC_APP_URL ??= 'http://localhost:3000';

// ──────────────────────────────────────────────────────────────
// next/cache — global mock
// ──────────────────────────────────────────────────────────────
// Server Actions call revalidatePath/revalidateTag, which throw
// "Invariant: static generation store missing" outside a Next request scope.
// A test file may still override this with its own vi.mock('next/cache', ...).
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
}));
