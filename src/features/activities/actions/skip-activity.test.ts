import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { skipActivity } from './skip-activity';

const ENROLLMENT_ID = '11111111-1111-1111-1111-111111111111';

// ---------------------------------------------------------------------------
// Chain mock factory — supports the full chain used across the action:
// select/update/insert/eq/single/maybeSingle + thenable resolution.
// ---------------------------------------------------------------------------

function createChainMock(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

/**
 * Wire mockFrom to return the correct chain per table. The action makes these
 * `from()` calls in order:
 *   1. organization_members (getAuthOrgIdResult → single)
 *   2. cadence_enrollments (load enrollment → single)
 *   3. cadence_steps (load step → maybeSingle)
 *   4. cadence_enrollments (update → eq)
 *   5. interactions (logLeadEvent → insert) — only when enrollment has lead_id
 */
function wireMocks(opts: { enrollment?: unknown; step?: unknown; updateError?: unknown }) {
  const memberChain = createChainMock({ data: { org_id: 'org-1' }, error: null });
  const enrollmentChain = createChainMock({
    data: opts.enrollment ?? { cadence_id: 'cad-1', current_step: 1, lead_id: 'lead-1' },
    error: null,
  });
  const stepChain = createChainMock({ data: opts.step ?? null, error: null });
  const updateChain = createChainMock({ error: opts.updateError ?? null });
  const interactionsChain = createChainMock({ data: null, error: null });

  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'organization_members':
        return memberChain;
      case 'cadence_steps':
        return stepChain;
      case 'interactions':
        return interactionsChain;
      case 'cadence_enrollments': {
        // First call (select) returns enrollment, subsequent (update) returns updateChain.
        const next = enrollmentChain._used ? updateChain : enrollmentChain;
        (enrollmentChain as Record<string, unknown>)._used = true;
        return next;
      }
      default:
        return createChainMock({ data: null, error: null });
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('skipActivity', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should reject an invalid (non-UUID) enrollment id', async () => {
    const result = await skipActivity('enr-1');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('ID inválido');
    }
  });

  it('should update next_step_due to 2 hours from now', async () => {
    wireMocks({});

    const before = Date.now();
    const result = await skipActivity(ENROLLMENT_ID);
    const after = Date.now();

    expect(result.success).toBe(true);
    if (!result.success) return;

    const nextDue = new Date(result.data.nextStepDue).getTime();
    const twoHoursMs = 2 * 60 * 60 * 1000;

    // nextStepDue should be ~2 hours from now (within test execution window)
    expect(nextDue).toBeGreaterThanOrEqual(before + twoHoursMs);
    expect(nextDue).toBeLessThanOrEqual(after + twoHoursMs);
  });

  it('should return error when database update fails', async () => {
    wireMocks({ updateError: { message: 'row not found' } });

    const result = await skipActivity(ENROLLMENT_ID);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao pular atividade');
    }
  });

  it('should return ISO string format for nextStepDue', async () => {
    wireMocks({});

    const result = await skipActivity(ENROLLMENT_ID);

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Validate ISO format
    const parsed = new Date(result.data.nextStepDue);
    expect(parsed.toISOString()).toBe(result.data.nextStepDue);
  });
});
