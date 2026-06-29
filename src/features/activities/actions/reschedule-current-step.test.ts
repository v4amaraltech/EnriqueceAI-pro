import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/lib/actions/handle-error', () => ({
  handleQueryError: (err: unknown) => (err ? { success: false, error: 'db error' } : null),
}));

let enrollmentResult: unknown;

function makeChain() {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'update']) chain[m] = vi.fn(() => chain);
  chain.single = vi.fn(() => Promise.resolve(enrollmentResult));
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
  return chain;
}

const supabase = { from: () => makeChain() };

import { rescheduleCurrentStep } from './reschedule-current-step';

const ENR = '11111111-1111-1111-1111-111111111111';
const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('rescheduleCurrentStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthOrgIdResult.mockResolvedValue({
      success: true,
      data: { orgId: 'org-1', userId: 'u1', supabase },
    });
    enrollmentResult = { data: { cadence_id: 'cad-1', current_step: 1, lead_id: 'lead-1', status: 'active' } };
  });

  it('reschedules an active enrollment to a future time', async () => {
    const when = future();
    const result = await rescheduleCurrentStep({ enrollmentId: ENR, nextStepDue: when });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.nextStepDue).toBe(when);
  });

  it('rejects a past time before touching the DB', async () => {
    const result = await rescheduleCurrentStep({
      enrollmentId: ENR,
      nextStepDue: new Date(Date.now() - 1000).toISOString(),
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('futuro');
    expect(auth.getAuthOrgIdResult).not.toHaveBeenCalled();
  });

  it('errors when the enrollment is not found', async () => {
    enrollmentResult = { data: null };
    const result = await rescheduleCurrentStep({ enrollmentId: ENR, nextStepDue: future() });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe('Enrollment não encontrado');
  });

  it('refuses to reschedule a non-active enrollment', async () => {
    enrollmentResult = { data: { cadence_id: 'cad-1', current_step: 1, lead_id: 'lead-1', status: 'completed' } };
    const result = await rescheduleCurrentStep({ enrollmentId: ENR, nextStepDue: future() });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('não está ativa');
  });
});
