import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as any;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() =>
    Promise.resolve({ from: mockFrom }),
  ),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const mockEnrollLeads = vi.fn();
vi.mock('@/features/cadences/actions/manage-cadences', () => ({
  enrollLeads: (...args: unknown[]) => mockEnrollLeads(...args),
}));

const mockEnrichLeadAction = vi.fn();
vi.mock('./enrich-lead', () => ({
  enrichLeadAction: (...args: unknown[]) => mockEnrichLeadAction(...args),
}));

import { revalidatePath } from 'next/cache';
import { createLead } from './create-lead';

// --- Chain helpers ---

function makeOrgMemberChain(orgId: string | null) {
  const singleMock = vi.fn().mockResolvedValue({ data: orgId ? { org_id: orgId } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

function makeAssigneeChain(found: boolean) {
  const singleMock = vi.fn().mockResolvedValue({ data: found ? { user_id: 'user-2' } : null });
  const eqStatusMock = vi.fn().mockReturnValue({ single: singleMock });
  const eqOrgMock = vi.fn().mockReturnValue({ eq: eqStatusMock });
  const eqUserMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqUserMock });
  return { select: selectMock };
}

function makeInsertChain(leadId: string | null, error: { message: string } | null = null) {
  const singleMock = vi.fn().mockResolvedValue({
    data: leadId ? { id: leadId } : null,
    error,
  });
  const selectMock = vi.fn().mockReturnValue({ single: singleMock });
  const insertMock = vi.fn().mockReturnValue({ select: selectMock });
  return { insert: insertMock };
}

function makeSubscriptionChain(planId: string | null) {
  const maybeSingleMock = vi.fn().mockResolvedValue({ data: planId ? { plan_id: planId } : null });
  const eqOrgMock = vi.fn().mockReturnValue({ maybeSingle: maybeSingleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  return { select: selectMock };
}

function makePlanChain(maxLeads: number) {
  const singleMock = vi.fn().mockResolvedValue({ data: { max_leads: maxLeads } });
  const eqIdMock = vi.fn().mockReturnValue({ single: singleMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqIdMock });
  return { select: selectMock };
}

function makeLeadCountChain(count: number) {
  const isMock = vi.fn().mockResolvedValue({ count });
  const eqOrgMock = vi.fn().mockReturnValue({ is: isMock });
  const selectMock = vi.fn().mockReturnValue({ eq: eqOrgMock });
  return { select: selectMock };
}

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const CADENCE_UUID = '660e8400-e29b-41d4-a716-446655440000';

const validInput = {
  first_name: 'João',
  last_name: 'Silva',
  email: 'joao@empresa.com',
  telefone: '11999999999',
  empresa: 'Acme Ltda',
  job_title: 'Gerente Comercial',
  lead_source: 'cold_outbound',
  assigned_to: VALID_UUID,
};

describe('createLead', () => {
  beforeEach(() => {
    resetMocks();
    mockEnrollLeads.mockResolvedValue({ success: true, data: { enrolled: 1, errors: [] } });
    mockEnrichLeadAction.mockResolvedValue({ success: true, data: undefined });
  });

  it('should create a lead with all required fields', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null); // skip limit check
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('new-lead-id');
    }
    expect(revalidatePath).toHaveBeenCalledWith('/leads');
    expect(mockEnrichLeadAction).toHaveBeenCalledWith('new-lead-id');
    expect(mockEnrollLeads).not.toHaveBeenCalled();
  });

  it('should enroll in cadence with immediate mode', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
      enrollment_mode: 'immediate',
    });

    expect(result.success).toBe(true);
    expect(mockEnrollLeads).toHaveBeenCalledWith(CADENCE_UUID, ['new-lead-id'], 'active');
  });

  it('should enroll with scheduled start and update next_step_due', async () => {
    const scheduledDate = '2026-03-01T09:00:00.000Z';
    let callCount = 0;
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null }),
      }),
    });

    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      if (callCount === 4) return makeInsertChain('new-lead-id');
      // 5th call: update enrollment next_step_due
      return { update: updateMock };
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
      enrollment_mode: 'scheduled',
      scheduled_start: scheduledDate,
    });

    expect(result.success).toBe(true);
    expect(mockEnrollLeads).toHaveBeenCalledWith(CADENCE_UUID, ['new-lead-id'], 'active');
    expect(updateMock).toHaveBeenCalledWith({ next_step_due: scheduledDate });
  });

  it('should return error when org not found', async () => {
    mockFrom.mockImplementation(() => makeOrgMemberChain(null));

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Organização não encontrada');
    }
  });

  it('should return error when assigned_to is not in org', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      return makeAssigneeChain(false);
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Responsável não pertence à organização');
    }
  });

  it('should return error for invalid input (missing required fields)', async () => {
    const result = await createLead({ assigned_to: VALID_UUID });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeTruthy();
    }
  });

  it('should succeed even when enrollment fails', async () => {
    mockEnrollLeads.mockRejectedValue(new Error('Enrollment error'));

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({
      ...validInput,
      cadence_id: CADENCE_UUID,
    });

    expect(result.success).toBe(true);
  });

  it('should succeed even when enrichment fails', async () => {
    mockEnrichLeadAction.mockRejectedValue(new Error('Enrichment error'));

    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
  });

  it('should return error when DB insert fails', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain(null, { message: 'Insert failed' });
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao criar lead');
    }
  });

  it('should return LEAD_LIMIT_REACHED when max_leads exceeded', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain('plan-1');
      if (callCount === 3) return makePlanChain(100);
      return makeLeadCountChain(100); // at limit
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('LEAD_LIMIT_REACHED');
      expect(result.error).toContain('100/100');
    }
  });

  it('should allow creation when under lead limit', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain('plan-1');
      if (callCount === 3) return makePlanChain(100);
      if (callCount === 4) return makeLeadCountChain(50); // under limit
      if (callCount === 5) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead(validInput);

    expect(result.success).toBe(true);
  });

  it('should pass is_inbound flag through', async () => {
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount === 1) return makeOrgMemberChain('org-1');
      if (callCount === 2) return makeSubscriptionChain(null);
      if (callCount === 3) return makeAssigneeChain(true);
      return makeInsertChain('new-lead-id');
    });

    const result = await createLead({ ...validInput, is_inbound: true });

    expect(result.success).toBe(true);
  });
});
