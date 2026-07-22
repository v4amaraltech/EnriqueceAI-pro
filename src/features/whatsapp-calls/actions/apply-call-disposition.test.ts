import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const reschedule = vi.hoisted(() => ({ rescheduleCurrentStep: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/features/activities/actions/reschedule-current-step', () => reschedule);

const rpc = vi.fn();
const supabase = { rpc };

import { applyCallDisposition } from './apply-call-disposition';

const ENR = '11111111-1111-1111-1111-111111111111';
const STEP = '22222222-2222-2222-2222-222222222222';

describe('applyCallDisposition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getAuthOrgIdResult.mockResolvedValue({ success: true, data: { userId: 'u1', supabase } });
    rpc.mockResolvedValue({ data: [{ advanced: true, completed: false, new_step: 2 }], error: null });
  });

  it('advances the cadence on a significant call', async () => {
    const result = await applyCallDisposition({ enrollmentId: ENR, stepId: STEP, disposition: 'significant' });
    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'advanced') {
      expect(result.data.advanced).toBe(true);
      expect(result.data.newStep).toBe(2);
    } else {
      throw new Error('expected advanced');
    }
    expect(rpc).toHaveBeenCalledWith('advance_enrollment_after_step', {
      p_enrollment_id: ENR,
      p_executed_step_id: STEP,
      p_performed_by: 'u1',
    });
  });

  it('reschedules on busy when a callback time is given', async () => {
    const when = new Date(Date.now() + 3600_000).toISOString();
    reschedule.rescheduleCurrentStep.mockResolvedValue({ success: true, data: { nextStepDue: when } });

    const result = await applyCallDisposition({
      enrollmentId: ENR,
      stepId: STEP,
      disposition: 'busy',
      callbackAt: when,
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.action === 'rescheduled') {
      expect(result.data.nextStepDue).toBe(when);
    } else {
      throw new Error('expected rescheduled');
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a callback time when the disposition reschedules', async () => {
    // `busy` = "Pediu para ligar depois" — o único desfecho que reagenda.
    const result = await applyCallDisposition({ enrollmentId: ENR, stepId: STEP, disposition: 'busy' });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain('horário');
    expect(reschedule.rescheduleCurrentStep).not.toHaveBeenCalled();
  });

  it('avança (não reagenda) quando o lead não atendeu — a cadência cuida da retentativa', async () => {
    const result = await applyCallDisposition({ enrollmentId: ENR, stepId: STEP, disposition: 'no_contact' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('advanced');
    expect(reschedule.rescheduleCurrentStep).not.toHaveBeenCalled();
  });

  it('does nothing on a technical failure (not_connected)', async () => {
    const result = await applyCallDisposition({ enrollmentId: ENR, stepId: STEP, disposition: 'not_connected' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.action).toBe('none');
    expect(rpc).not.toHaveBeenCalled();
    expect(auth.getAuthOrgIdResult).not.toHaveBeenCalled();
  });
});
