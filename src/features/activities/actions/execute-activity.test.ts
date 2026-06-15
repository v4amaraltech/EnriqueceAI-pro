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

// Schema now requires UUIDs for the id fields (enrollmentId/cadenceId/stepId/
// leadId/orgId/templateId). Use real UUIDs so safeParse passes.
const ENROLLMENT_ID = '11111111-1111-1111-1111-111111111111';
const CADENCE_ID = '22222222-2222-2222-2222-222222222222';
const STEP_ID = '33333333-3333-3333-3333-333333333333';
const LEAD_ID = '44444444-4444-4444-4444-444444444444';
const ORG_ID = '55555555-5555-5555-5555-555555555555';
const TEMPLATE_ID = '66666666-6666-6666-6666-666666666666';

const baseInput: ExecuteActivityInput = {
  enrollmentId: ENROLLMENT_ID,
  cadenceId: CADENCE_ID,
  stepId: STEP_ID,
  leadId: LEAD_ID,
  orgId: ORG_ID,
  cadenceCreatedBy: 'user-1',
  channel: 'email',
  to: 'contato@abc.com',
  subject: 'Olá Empresa ABC',
  body: '<p>Corpo do email</p>',
  aiGenerated: false,
  templateId: TEMPLATE_ID,
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
  const chainable = ['select', 'insert', 'update', 'eq', 'neq', 'gt', 'gte', 'lt', 'is', 'in', 'order', 'limit'];
  for (const m of chainable) chain[m] = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

// Org-member chain consumed first by getAuthOrgIdResult().
function orgMemberChain() {
  return createChainMock({ data: { org_id: 'org-1' }, error: null });
}

/**
 * Route `from()` calls by table. `interactions` is queried multiple times in a
 * fixed order (idempotency → insert → external update / failed update); pass a
 * sequence so each successive `interactions` call gets the next result. Any
 * unspecified table resolves to { data: null }.
 */
function wireMocks(opts: {
  interactions: unknown[];
  whatsappConnection?: unknown; // result of whatsapp_connections lookup
  executedStep?: unknown;
  currentEnrollment?: unknown;
  nextStep?: unknown;
}) {
  const interactionsQueue = [...opts.interactions];
  mockFrom.mockImplementation((table: string) => {
    switch (table) {
      case 'organization_members':
        return orgMemberChain();
      case 'interactions': {
        const next = interactionsQueue.length > 0 ? interactionsQueue.shift() : { data: null };
        return createChainMock(next);
      }
      case 'whatsapp_connections':
        return createChainMock(opts.whatsappConnection ?? { data: null });
      case 'cadence_steps':
        // Two reads use single (executedStep) / maybeSingle (nextStep). Return a
        // chain whose single resolves executedStep and maybeSingle resolves
        // nextStep so both reads get correct shapes regardless of order.
        return cadenceStepsChain(opts.executedStep ?? { data: { step_order: 1 } }, opts.nextStep ?? { data: null });
      case 'cadence_enrollments':
        return createChainMock(opts.currentEnrollment ?? { data: { current_step: 1 } });
      case 'leads':
        return createChainMock({ data: null }); // markLeadContacted (fire-and-forget)
      default:
        return createChainMock({ data: null });
    }
  });
}

function cadenceStepsChain(singleResult: unknown, maybeSingleResult: unknown) {
  const chain = createChainMock({ data: null });
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(singleResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(maybeSingleResult));
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

  it('should reconcile (advance) and return success if interaction already exists', async () => {
    // idempotency lookup returns an existing interaction → não barra mais:
    // reconcilia o avanço via RPC (caso o avanço anterior tenha falhado e
    // deixado o enrollment preso) e retorna sucesso, sem reenviar.
    wireMocks({ interactions: [{ data: { id: 'existing-int' } }] });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe('existing-int');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'advance_enrollment_after_step',
      expect.objectContaining({ p_enrollment_id: ENROLLMENT_ID, p_executed_step_id: STEP_ID }),
    );
  });

  it('should return error if interaction insert fails', async () => {
    // idempotency → null, insert → null (failure to record)
    wireMocks({ interactions: [{ data: null }, { data: null }] });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Falha ao registrar interação');
    }
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should send email, record interaction, and advance step on success', async () => {
    mockSendEmail.mockResolvedValue({
      success: true,
      messageId: 'gmail-msg-123',
    });

    wireMocks({
      // idempotency → null, insert → { id: int-1 }, external-id update → null
      interactions: [{ data: null }, { data: { id: 'int-1' } }, { data: null }],
      executedStep: { data: { step_order: 1 } },
      currentEnrollment: { data: { current_step: 1 } },
      nextStep: { data: { step_order: 2 } },
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.interactionId).toBe('int-1');

    expect(mockSendEmail).toHaveBeenCalledWith(
      'user-1',
      ORG_ID,
      {
        to: 'contato@abc.com',
        subject: 'Olá Empresa ABC',
        htmlBody: '<p>Corpo do email</p>',
      },
      'int-1',
      mockSupabase,
    );

    // O avanço agora é atômico via RPC (não mais via reads/updates separados).
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'advance_enrollment_after_step',
      expect.objectContaining({ p_enrollment_id: ENROLLMENT_ID, p_executed_step_id: STEP_ID }),
    );
  });

  it('should mark enrollment completed when no next step exists', async () => {
    mockSendEmail.mockResolvedValue({ success: true, messageId: 'msg-2' });

    wireMocks({
      interactions: [{ data: null }, { data: { id: 'int-2' } }, { data: null }],
      executedStep: { data: { step_order: 3 } },
      currentEnrollment: { data: { current_step: 3 } },
      nextStep: { data: null }, // no next step → enrollment completed
    });

    const result = await executeActivity(baseInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interactionId).toBe('int-2');
    }
  });

  it('should return error and mark interaction failed when email send fails', async () => {
    mockSendEmail.mockResolvedValue({
      success: false,
      error: 'Token expired',
    });

    // idempotency → null, insert → { id: int-3 }, failed-update → null
    wireMocks({ interactions: [{ data: null }, { data: { id: 'int-3' } }, { data: null }] });

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
    mockCheckAndDeductCredit.mockResolvedValue({
      allowed: false,
      error: 'Sem plano WhatsApp ativo',
    });

    wireMocks({
      // idempotency → null, insert → { id }, failed-update (no-credit) → null
      interactions: [{ data: null }, { data: { id: 'int-wa-1' } }, { data: null }],
      whatsappConnection: { data: { id: 'wac-1' } },
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

    wireMocks({
      interactions: [{ data: null }, { data: { id: 'int-wa-2' } }, { data: null }],
      whatsappConnection: { data: { id: 'wac-1' } }, // Meta connection present → uses WhatsAppService
      executedStep: { data: { step_order: 1 } },
      currentEnrollment: { data: { current_step: 1 } },
      nextStep: { data: { step_order: 2 } },
    });

    const result = await executeActivity(whatsappInput);

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.interactionId).toBe('int-wa-2');
    expect(mockSendWhatsApp).toHaveBeenCalledWith(
      ORG_ID,
      { to: '5511999887766', body: 'Olá, tudo bem?' },
      mockSupabase,
    );
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('should return error and mark interaction failed when WhatsApp send fails', async () => {
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

    wireMocks({
      interactions: [{ data: null }, { data: { id: 'int-wa-3' } }, { data: null }],
      whatsappConnection: { data: { id: 'wac-1' } }, // Meta connection → WhatsAppService used
    });

    const result = await executeActivity(whatsappInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Connection not found');
    }
  });
});
