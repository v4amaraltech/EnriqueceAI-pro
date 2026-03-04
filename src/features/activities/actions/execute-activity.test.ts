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

const mockSendEmail = vi.fn();
vi.mock('@/features/integrations/services/email.service', () => ({
  EmailService: {
    sendEmail: (...args: unknown[]) => mockSendEmail(...args),
  },
}));

const mockCheckAndDeductCredit = vi.fn();
vi.mock('@/features/integrations/services/whatsapp-credit.service', () => ({
  WhatsAppCreditService: {
    checkAndDeductCredit: (...args: unknown[]) => mockCheckAndDeductCredit(...args),
  },
}));

const mockSendWhatsApp = vi.fn();
vi.mock('@/features/integrations/services/whatsapp.service', () => ({
  WhatsAppService: {
    sendMessage: (...args: unknown[]) => mockSendWhatsApp(...args),
  },
}));

import { executeActivity } from './execute-activity';
import type { ExecuteActivityInput } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseInput: ExecuteActivityInput = {
  enrollmentId: 'enr-1',
  cadenceId: 'cad-1',
  stepId: 'step-1',
  leadId: 'lead-1',
  orgId: 'org-1',
  cadenceCreatedBy: 'user-1',
  channel: 'email',
  to: 'contato@abc.com',
  subject: 'Olá Empresa ABC',
  body: '<p>Corpo do email</p>',
  aiGenerated: false,
  templateId: 'tpl-1',
};

const whatsappInput: ExecuteActivityInput = {
  ...baseInput,
  channel: 'whatsapp',
  to: '5511999887766',
  subject: '',
  body: 'Olá, tudo bem?',
};

// ---------------------------------------------------------------------------
// Chain mock factory
// ---------------------------------------------------------------------------

function createChainMock(finalResult: unknown) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gt = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

// ---------------------------------------------------------------------------
// Tests — Email (existing)
// ---------------------------------------------------------------------------

describe('executeActivity — email channel', () => {
  beforeEach(() => {
    resetMocks();
    mockSendEmail.mockReset();
    mockSendWhatsApp.mockReset();
    mockCheckAndDeductCredit.mockReset();
  });

  it('should return ALREADY_EXECUTED if interaction exists', async () => {
    const idempotencyChain = createChainMock({ data: { id: 'existing-int' } });
    mockFrom.mockImplementation(() => idempotencyChain);

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('ALREADY_EXECUTED');
      expect(result.error).toBe('Esta atividade já foi executada');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should return error if interaction insert fails', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: null });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      return insertChain;
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Falha ao registrar interação');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should send email, record interaction, and advance step on success', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-1' } });
    const updateExtChain = createChainMock({ data: null });
    const currentStepChain = createChainMock({ data: { step_order: 1 } });
    const nextStepChain = createChainMock({ data: { step_order: 2 } });
    const advanceChain = createChainMock({ data: null });

    mockSendEmail.mockResolvedValue({
      success: true,
      messageId: 'gmail-msg-123',
    });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      if (callIndex === 2) return insertChain;
      if (callIndex === 3) return updateExtChain;
      if (callIndex === 4) return currentStepChain;
      if (callIndex === 5) return nextStepChain;
      if (callIndex === 6) return advanceChain;
      return createChainMock({ data: null });
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.interactionId).toBe('int-1');

    expect(mockSendEmail).toHaveBeenCalledWith(
      'user-1',
      'org-1',
      {
        to: 'contato@abc.com',
        subject: 'Olá Empresa ABC',
        htmlBody: '<p>Corpo do email</p>',
      },
      'int-1',
      mockSupabase,
    );
  });

  it('should mark enrollment completed when no next step exists', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-2' } });
    const updateExtChain = createChainMock({ data: null });
    const currentStepChain = createChainMock({ data: { step_order: 3 } });
    const nextStepChain = createChainMock({ data: null });
    const completeChain = createChainMock({ data: null });

    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-2' });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      if (callIndex === 2) return insertChain;
      if (callIndex === 3) return updateExtChain;
      if (callIndex === 4) return currentStepChain;
      if (callIndex === 5) return nextStepChain;
      if (callIndex === 6) return completeChain;
      return createChainMock({ data: null });
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe('int-2');
    }
  });

  it('should return error and mark interaction failed when email send fails', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-3' } });
    const failUpdateChain = createChainMock({ data: null });

    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'Token expired',
    });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      if (callIndex === 2) return insertChain;
      if (callIndex === 3) return failUpdateChain;
      return createChainMock({ data: null });
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Token expired');
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — WhatsApp channel
// ---------------------------------------------------------------------------

describe('executeActivity — whatsapp channel', () => {
  beforeEach(() => {
    resetMocks();
    mockSendEmail.mockReset();
    mockSendWhatsApp.mockReset();
    mockCheckAndDeductCredit.mockReset();
  });

  it('should return error when no WhatsApp credits', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-wa-1' } });

    mockCheckAndDeductCredit.mockResolvedValue({
      allowed: false,
      error: 'Sem plano WhatsApp ativo',
    });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      return insertChain;
    });

    const result = await executeActivity(whatsappInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('WhatsApp');
    }
    expect(mockSendWhatsApp).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should send WhatsApp message and record interaction on success', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-wa-2' } });
    const updateExtChain = createChainMock({ data: null });
    const currentStepChain = createChainMock({ data: { step_order: 1 } });
    const nextStepChain = createChainMock({ data: { step_order: 2 } });
    const advanceChain = createChainMock({ data: null });

    mockCheckAndDeductCredit.mockResolvedValue({
      allowed: true,
      used: 11,
      limit: 500,
      isOverage: false,
    });

    mockSendWhatsApp.mockResolvedValue({
      success: true,
      messageId: 'wamid.123',
    });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      if (callIndex === 2) return insertChain;
      if (callIndex === 3) return updateExtChain;
      if (callIndex === 4) return currentStepChain;
      if (callIndex === 5) return nextStepChain;
      if (callIndex === 6) return advanceChain;
      return createChainMock({ data: null });
    });

    const result = await executeActivity(whatsappInput);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.interactionId).toBe('int-wa-2');
    expect(mockSendWhatsApp).toHaveBeenCalledWith(
      'org-1',
      { to: '5511999887766', body: 'Olá, tudo bem?' },
      mockSupabase,
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should return error and mark interaction failed when WhatsApp send fails', async () => {
    const idempotencyChain = createChainMock({ data: null });
    const insertChain = createChainMock({ data: { id: 'int-wa-3' } });
    const failUpdateChain = createChainMock({ data: null });

    mockCheckAndDeductCredit.mockResolvedValue({
      allowed: true,
      used: 100,
      limit: 500,
      isOverage: false,
    });

    mockSendWhatsApp.mockResolvedValue({
      success: false,
      error: 'Connection not found',
    });

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) return idempotencyChain;
      if (callIndex === 2) return insertChain;
      if (callIndex === 3) return failUpdateChain;
      return createChainMock({ data: null });
    });

    const result = await executeActivity(whatsappInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Connection not found');
    }
  });
});
