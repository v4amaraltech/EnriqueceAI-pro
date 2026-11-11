import { beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSupabase, mockSupabaseFrom, resetMocks } from '@tests/mocks/supabase';
const mockFrom = mockSupabaseFrom as ReturnType<typeof vi.fn>;

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(() => Promise.resolve(mockSupabase)),
}));

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuth: vi.fn(() => Promise.resolve({ id: 'user-1', email: 'test@test.com' })),
}));

import { isCallDockTask } from '@/features/cockpit/utils/call-dock';

import { fetchPendingActivities } from './fetch-pending-activities';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockLead = {
  id: 'lead-1',
  org_id: 'org-1',
  nome_fantasia: 'Empresa ABC',
  razao_social: 'ABC Ltda',
  cnpj: '11222333000181',
  email: 'contato@abc.com',
  telefone: '11999990000',
  municipio: 'São Paulo',
  uf: 'SP',
  porte: 'ME',
  socios: null,
  endereco: null,
  instagram: null,
  linkedin: null,
  website: null,
  status: 'new' as const,
  enrichment_status: 'enriched' as const,
  notes: null,
  fit_score: null,
};

const mockCadence = {
  id: 'cad-1',
  name: 'Outbound V1',
  total_steps: 3,
  created_by: 'user-1',
};

const mockEnrollment = {
  id: 'enr-1',
  cadence_id: 'cad-1',
  lead_id: 'lead-1',
  current_step: 1,
  status: 'active',
  next_step_due: '2026-02-19T10:00:00Z',
  lead: mockLead,
  cadence: mockCadence,
};

const mockStep = {
  id: 'step-1',
  cadence_id: 'cad-1',
  step_order: 1,
  channel: 'email' as const,
  template_id: 'tpl-1',
  delay_days: 0,
  delay_hours: 0,
  ai_personalization: false,
  created_at: '2026-01-01T00:00:00Z',
};

const mockTemplate = {
  id: 'tpl-1',
  org_id: 'org-1',
  name: 'Welcome Email',
  channel: 'email' as const,
  subject: 'Olá {{nome_fantasia}}',
  body: 'Prezada {{nome_fantasia}}, como vai?',
  variables_used: ['nome_fantasia'],
  is_system: false,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
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
  chain.not = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.single = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.maybeSingle = vi.fn().mockImplementation(() => Promise.resolve(finalResult));
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(finalResult).then(resolve, reject);
  return chain;
}

// Org-member chain consumed first by getAuthOrgIdResult(). Returns a valid org
// so the action proceeds to the real queries under test.
function orgMemberChain() {
  return createChainMock({ data: { org_id: 'org-1' }, error: null });
}

/**
 * Route `from()` calls by table name. The action queries (in order):
 *   organization_members → cadence_enrollments → cadence_steps →
 *   message_templates → scheduled_activities. The executed-steps filter uses
 *   supabase.rpc (already stubbed on mockSupabase to resolve { data: null }).
 */
function wireByTable(map: Record<string, unknown>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'organization_members') return orgMemberChain();
    const result = map[table] ?? { data: [], error: null };
    return createChainMock(result);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchPendingActivities', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('should return empty array when no enrollments are due and no return is pending', async () => {
    wireByTable({ cadence_enrollments: { data: [], error: null } });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('orders the queue by next_step_due (most overdue first) and caps at 1500, not 500', async () => {
    // Regressão: o limit(500) + order(enrolled_at desc) antigo fazia SDR de
    // backlog alto perder cadências vencidas silenciosamente ao cruzar 500.
    let enrollChain: Record<string, unknown> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return orgMemberChain();
      const chain = createChainMock({ data: [], error: null });
      if (table === 'cadence_enrollments') enrollChain = chain;
      return chain;
    });

    await fetchPendingActivities();

    expect(enrollChain?.order).toHaveBeenCalledWith('next_step_due', { ascending: true });
    expect(enrollChain?.limit).toHaveBeenCalledWith(1500);
  });

  it('should return error when enrollment query fails', async () => {
    wireByTable({
      cadence_enrollments: { data: null, error: { message: 'connection refused' } },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('Erro ao buscar atividades pendentes');
    }
  });

  it('should return mapped PendingActivity when enrollments exist', async () => {
    wireByTable({
      cadence_enrollments: { data: [mockEnrollment], error: null },
      cadence_steps: { data: [mockStep] },
      message_templates: { data: [mockTemplate] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(1);

    const activity = result.data[0]!;
    expect(activity.enrollmentId).toBe('enr-1');
    expect(activity.cadenceId).toBe('cad-1');
    expect(activity.cadenceName).toBe('Outbound V1');
    expect(activity.cadenceCreatedBy).toBe('user-1');
    expect(activity.stepId).toBe('step-1');
    expect(activity.stepOrder).toBe(1);
    expect(activity.totalSteps).toBe(3);
    expect(activity.channel).toBe('email');
    expect(activity.templateId).toBe('tpl-1');
    expect(activity.templateSubject).toBe('Olá {{nome_fantasia}}');
    expect(activity.templateBody).toBe('Prezada {{nome_fantasia}}, como vai?');
    expect(activity.aiPersonalization).toBe(false);
    // The action derives municipio/uf from lead.endereco (null here) and
    // primeiro_nome from first_name/socios (both absent → null).
    expect(activity.lead).toEqual({
      ...mockLead,
      municipio: null,
      uf: null,
      primeiro_nome: null,
    });
  });

  it('tira da fila os passos de cadência executada pela IA (executor bdr_ai)', async () => {
    const daIa = { ...mockEnrollment, id: 'enr-ia', cadence: { ...mockCadence, executor: 'bdr_ai' } };
    const doSdr = { ...mockEnrollment, cadence: { ...mockCadence, executor: 'sdr' } };
    wireByTable({
      cadence_enrollments: { data: [daIa, doSdr], error: null },
      cadence_steps: { data: [mockStep] },
      message_templates: { data: [mockTemplate] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((a) => a.enrollmentId)).toEqual(['enr-1']);
  });

  it('should skip enrollments without matching step', async () => {
    const enrollmentNoStep = {
      ...mockEnrollment,
      current_step: 99, // step doesn't exist
    };

    wireByTable({
      cadence_enrollments: { data: [enrollmentNoStep], error: null },
      cadence_steps: { data: [mockStep] }, // step_order=1, not 99
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  it('should handle steps without templates', async () => {
    const stepNoTemplate = { ...mockStep, template_id: null };

    wireByTable({
      cadence_enrollments: { data: [mockEnrollment], error: null },
      cadence_steps: { data: [stepNoTemplate] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.templateId).toBeNull();
    expect(result.data[0]!.templateSubject).toBeNull();
    expect(result.data[0]!.templateBody).toBeNull();
  });

  it('should skip enrollments missing lead or cadence', async () => {
    const enrollmentNoLead = {
      ...mockEnrollment,
      id: 'enr-bad',
      lead: null,
    };

    wireByTable({
      cadence_enrollments: { data: [enrollmentNoLead], error: null },
      cadence_steps: { data: [mockStep] },
      message_templates: { data: [mockTemplate] },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(0);
    }
  });

  // --- Epic 7: gate de elegibilidade da Ligação via WhatsApp ---
  const waCallStep = {
    ...mockStep,
    id: 'step-wa',
    channel: 'phone' as const,
    template_id: null,
    call_provider: 'whatsapp' as const,
  };

  it('should suppress a WhatsApp-call step when the lead has no reachable number', async () => {
    const leadNoPhone = { ...mockLead, telefone: null, socios: null, phones: null };
    wireByTable({
      cadence_enrollments: { data: [{ ...mockEnrollment, lead: leadNoPhone }], error: null },
      cadence_steps: { data: [waCallStep] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('should keep a WhatsApp-call step when the lead has a reachable number', async () => {
    wireByTable({
      cadence_enrollments: { data: [{ ...mockEnrollment, lead: { ...mockLead, phones: null } }], error: null },
      cadence_steps: { data: [waCallStep] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.channel).toBe('phone');
  });

  it('should suppress a WhatsApp-call step when the number was flagged not-WhatsApp', async () => {
    const leadFlagged = { ...mockLead, phones: null, whatsapp_invalid_at: '2026-02-01T00:00:00Z' };
    wireByTable({
      cadence_enrollments: { data: [{ ...mockEnrollment, lead: leadFlagged }], error: null },
      cadence_steps: { data: [waCallStep] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toHaveLength(0);
  });

  it('should handle multiple enrollments across different cadences', async () => {
    const mockLead2 = { ...mockLead, id: 'lead-2', nome_fantasia: 'Empresa XYZ' };
    const mockCadence2 = { ...mockCadence, id: 'cad-2', name: 'Follow Up' };
    const enrollment2 = {
      ...mockEnrollment,
      id: 'enr-2',
      cadence_id: 'cad-2',
      lead_id: 'lead-2',
      lead: mockLead2,
      cadence: mockCadence2,
    };
    const step2 = { ...mockStep, id: 'step-2', cadence_id: 'cad-2' };

    wireByTable({
      cadence_enrollments: { data: [mockEnrollment, enrollment2], error: null },
      cadence_steps: { data: [mockStep, step2] },
      message_templates: { data: [mockTemplate] },
      scheduled_activities: { data: [], error: null },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data).toHaveLength(2);
    const names = result.data.map((a) => a.cadenceName).sort();
    expect(names).toEqual(['Follow Up', 'Outbound V1']);
  });

  it('separa a tarefa "Definir destino" do retorno agendado pelo `kind`', async () => {
    const base = { lead_id: 'lead-1', call_provider: null, scheduled_at: '2026-11-06T12:00:00Z', leads: mockLead };
    wireByTable({
      cadence_enrollments: { data: [mockEnrollment], error: null },
      cadence_steps: { data: [mockStep] },
      message_templates: { data: [mockTemplate] },
      scheduled_activities: {
        data: [
          { ...base, id: 'sa-ret', channel: 'phone', kind: 'return', notes: 'ligar 14h' },
          {
            ...base,
            id: 'sa-limbo',
            channel: 'research',
            kind: 'limbo_followup',
            notes: 'Definir destino: e-mail voltou (bounce) na Hotelaria.',
          },
        ],
        error: null,
      },
    });

    const result = await fetchPendingActivities();

    expect(result.success).toBe(true);
    if (!result.success) return;
    const ret = result.data.find((a) => a.enrollmentId === 'scheduled:sa-ret');
    const limbo = result.data.find((a) => a.enrollmentId === 'scheduled:sa-limbo');
    expect(ret).toMatchObject({ scheduledKind: 'return', activityName: 'Retorno: ligar 14h' });
    expect(limbo).toMatchObject({
      scheduledKind: 'limbo_followup',
      cadenceName: 'Definir destino',
      activityName: 'Definir destino: e-mail voltou (bounce) na Hotelaria.',
    });
    // Passo de cadência não tem tipo de atividade avulsa.
    expect(result.data.find((a) => a.enrollmentId === 'enr-1')?.scheduledKind).toBeUndefined();
  });

  it('busca só as colunas do lead que a fila usa (inclui whatsapp_invalid_at, nunca *)', async () => {
    const selects: string[] = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') return orgMemberChain();
      const chain = createChainMock({ data: [], error: null });
      (chain.select as ReturnType<typeof vi.fn>).mockImplementation((cols: string) => {
        selects.push(`${table}:${cols}`);
        return chain;
      });
      return chain;
    });

    await fetchPendingActivities();

    const enrollmentSelect = selects.find((s) => s.startsWith('cadence_enrollments:'));
    expect(enrollmentSelect).toBeDefined();
    expect(enrollmentSelect).not.toContain('leads!inner(*)');
    expect(enrollmentSelect).toContain('whatsapp_invalid_at');
    for (const col of ['telefone', 'phones', 'socios', 'endereco', 'custom_field_values', 'assigned_to']) {
      expect(enrollmentSelect).toContain(col);
    }
  });

  // Produção 09/11/2026 17:34 BRT: retorno phone do Mercante Net, criado pelo
  // gestor, lead qualified da Ana, sem enrollment due. A fila saía vazia.
  const ANA_ID = '9d7f643f-ee3a-460b-a3ff-b98e8209253f';
  const MERCANTE_RETURN = {
    id: 'def69798-ffba-42cb-a5d3-1e70cac71ffd',
    lead_id: '969ea854-1724-4f22-85a3-3633cd314553',
    channel: 'phone' as const,
    call_provider: null,
    kind: 'return' as const,
    scheduled_at: '2026-11-09T20:30:00Z',
    notes: 'Teste E2E cockpit Mercante Net',
    user_id: 'c6213fe4-manager-vinicius',
    leads: {
      ...mockLead,
      id: '969ea854-1724-4f22-85a3-3633cd314553',
      nome_fantasia: 'Mercante Net',
      status: 'qualified' as const,
      assigned_to: ANA_ID,
    },
  };

  function wireManagerQueue(scheduled: unknown) {
    let scheduledChain: ReturnType<typeof createChainMock> | undefined;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return createChainMock({ data: { org_id: 'org-1', role: 'manager' }, error: null });
      }
      if (table === 'scheduled_activities') {
        scheduledChain = createChainMock(scheduled);
        return scheduledChain;
      }
      return createChainMock({ data: [], error: null });
    });
    return {
      scheduledEq: () => scheduledChain?.eq as ReturnType<typeof vi.fn> | undefined,
    };
  }

  it('mostra o retorno phone do lead qualified da Ana mesmo sem cadência vencida e com criador != assignee', async () => {
    const { scheduledEq } = wireManagerQueue({ data: [MERCANTE_RETURN], error: null });

    const result = await fetchPendingActivities({ assignedTo: ANA_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toHaveLength(1);
    const task = result.data[0]!;
    expect(task).toMatchObject({
      enrollmentId: 'scheduled:def69798-ffba-42cb-a5d3-1e70cac71ffd',
      channel: 'phone',
      callProvider: null,
      scheduledKind: 'return',
      nextStepDue: '2026-11-09T20:30:00Z',
      activityName: 'Retorno: Teste E2E cockpit Mercante Net',
    });
    expect(task.lead.assigned_to).toBe(ANA_ID);
    expect(task.lead.status).toBe('qualified');
    expect(isCallDockTask(task)).toBe(true);
    expect(scheduledEq()).toHaveBeenCalledWith('leads.assigned_to', ANA_ID);
    expect(scheduledEq()).toHaveBeenCalledWith('status', 'pending');
    const userIdFilter = scheduledEq()?.mock.calls.find((call) => call[0] === 'user_id');
    expect(userIdFilter).toBeUndefined();
  });

  it('mantém o retorno quando a cadência due não gera passo (segundo corte da fila)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'organization_members') {
        return createChainMock({ data: { org_id: 'org-1', role: 'manager' }, error: null });
      }
      if (table === 'cadence_enrollments') {
        return createChainMock({
          data: [{ ...mockEnrollment, current_step: 99, lead: { ...mockLead, assigned_to: ANA_ID } }],
          error: null,
        });
      }
      if (table === 'cadence_steps') return createChainMock({ data: [mockStep], error: null });
      if (table === 'scheduled_activities') return createChainMock({ data: [MERCANTE_RETURN], error: null });
      return createChainMock({ data: [], error: null });
    });

    const result = await fetchPendingActivities({ assignedTo: ANA_ID });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.map((a) => a.enrollmentId)).toEqual([
      'scheduled:def69798-ffba-42cb-a5d3-1e70cac71ffd',
    ]);
    expect(isCallDockTask(result.data[0]!)).toBe(true);
  });

  it('com includeLeadCard anexa o motivo e não muda a fila quando a opção falta', async () => {
    const reasonId = '863d2e55-7160-4d2a-818c-94846d3040da';
    wireByTable({
      cadence_enrollments: {
        data: [{
          ...mockEnrollment,
          loss_notes: 'nota da cadência',
          lead: {
            ...mockLead,
            id: '11111111-1111-4111-8111-111111111111',
            lost_at: '2026-04-17T10:22:48.000Z',
            loss_notes: null,
            loss_reason_id: reasonId,
          },
        }],
        error: null,
      },
      cadence_steps: { data: [mockStep] },
      message_templates: { data: [mockTemplate] },
      scheduled_activities: { data: [], error: null },
      loss_reasons: { data: [{ id: reasonId, name: 'Deixou de responder' }], error: null },
      interactions: { data: [{ lead_id: '11111111-1111-4111-8111-111111111111', created_at: '2026-11-10T15:00:00.000Z' }], error: null },
    });

    const plain = await fetchPendingActivities();
    expect(plain.success).toBe(true);
    if (!plain.success) return;
    expect(plain.data[0]?.lead).not.toHaveProperty('loss_reason_name');

    const withCard = await fetchPendingActivities({ includeLeadCard: true });
    expect(withCard.success).toBe(true);
    if (!withCard.success) return;
    expect(withCard.data[0]?.lead.loss_reason_name).toBe('Deixou de responder');
    expect(withCard.data[0]?.lead.enrollment_loss_notes).toBe('nota da cadência');
    expect(withCard.data[0]?.lead.lost_at).toBe('2026-04-17T10:22:48.000Z');
    expect(withCard.data[0]?.lead.last_interaction_at).toBe('2026-11-10T15:00:00.000Z');
    expect(plain.data[0]?.lead).not.toHaveProperty('last_interaction_at');
  });
});
