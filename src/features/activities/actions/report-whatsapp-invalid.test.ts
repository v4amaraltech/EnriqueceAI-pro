import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getAuthOrgIdResult: vi.fn() }));
const leadEvent = vi.hoisted(() => ({ logLeadEvent: vi.fn() }));
const notif = vi.hoisted(() => ({ createNotification: vi.fn() }));

vi.mock('@/lib/auth/get-org-id', () => auth);
vi.mock('@/features/leads/actions/log-lead-event', () => leadEvent);
vi.mock('@/features/notifications/services/notification.service', () => notif);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { reportWhatsAppInvalid } from './report-whatsapp-invalid';

const ORG = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';
const INPUT = {
  enrollmentId: '11111111-1111-4111-8111-111111111111',
  cadenceId: '22222222-2222-4222-8222-222222222222',
  stepId: '33333333-3333-4333-8333-333333333333',
  leadId: '44444444-4444-4444-8444-444444444444',
  orgId: ORG,
};

interface Captured {
  table: string;
  op: 'update' | 'insert';
  payload: Record<string, unknown>;
}

let captured: Captured[];
/** Passos da cadência devolvidos pela query de cadence_steps. */
let steps: Array<{ step_order: number; channel: string }>;
/** step_order do passo atual (query por id). */
let currentStepOrder: number;

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  let op: Captured['op'] | null = null;

  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.update = vi.fn((payload: Record<string, unknown>) => {
    op = 'update';
    captured.push({ table, op, payload });
    return chain;
  });
  chain.insert = vi.fn((payload: Record<string, unknown>) => {
    captured.push({ table, op: 'insert', payload });
    return Promise.resolve({ error: null });
  });
  chain.single = vi.fn(() => Promise.resolve({ data: { step_order: currentStepOrder }, error: null }));
  chain.maybeSingle = vi.fn(() => {
    if (table === 'cadences') return Promise.resolve({ data: { name: 'Recovery' }, error: null });
    if (table === 'leads') {
      return Promise.resolve({
        data: { assigned_to: 'sdr-1', nome_fantasia: 'Empresa Teste', razao_social: null },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    let result: unknown = { data: null, error: null };
    if (table === 'cadence_steps' && !op) result = { data: steps, error: null };
    return Promise.resolve(result).then(resolve, reject);
  };

  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  captured = [];
  currentStepOrder = 7;
  steps = [
    { step_order: 6, channel: 'email' },
    { step_order: 7, channel: 'whatsapp' },
  ];

  auth.getAuthOrgIdResult.mockResolvedValue({
    success: true,
    data: { orgId: ORG, userId: 'user-1', supabase: { from: (t: string) => makeChain(t) } },
  });
  leadEvent.logLeadEvent.mockResolvedValue(undefined);
  notif.createNotification.mockResolvedValue(undefined);
});

const enrollmentUpdates = () => captured.filter((c) => c.table === 'cadence_enrollments' && c.op === 'update');

describe('reportWhatsAppInvalid', () => {
  it('marca o lead como sem WhatsApp e registra a tentativa falha', async () => {
    const result = await reportWhatsAppInvalid(INPUT);

    expect(result.success).toBe(true);
    const leadUpdate = captured.find((c) => c.table === 'leads' && c.op === 'update');
    expect(leadUpdate?.payload).toHaveProperty('whatsapp_invalid_at');
    const interaction = captured.find((c) => c.table === 'interactions' && c.op === 'insert');
    expect(interaction?.payload).toMatchObject({ channel: 'whatsapp', type: 'failed', metadata: { error: 'not_whatsapp' } });
  });

  it('avança para o próximo passo de outro canal quando existe', async () => {
    currentStepOrder = 3;
    steps = [
      { step_order: 3, channel: 'whatsapp' },
      { step_order: 4, channel: 'whatsapp' },
      { step_order: 5, channel: 'phone' },
    ];

    await reportWhatsAppInvalid(INPUT);

    expect(enrollmentUpdates()[0]?.payload).toEqual({ current_step: 5 });
    expect(notif.createNotification).not.toHaveBeenCalled();
  });

  it('sem passo de outro canal: PAUSA a inscrição, nunca encerra', async () => {
    await reportWhatsAppInvalid(INPUT);

    const [update] = enrollmentUpdates();
    expect(update?.payload).toEqual({ status: 'paused' });
    expect(update?.payload).not.toHaveProperty('completed_at');
    expect(JSON.stringify(captured)).not.toContain('completed');
  });

  it('pausa deixa rastro na timeline e avisa o dono do lead', async () => {
    await reportWhatsAppInvalid(INPUT);

    expect(leadEvent.logLeadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: ORG,
        leadId: INPUT.leadId,
        event: 'cadence_paused',
        message: expect.stringContaining('sem WhatsApp'),
        metadata: expect.objectContaining({ reason: 'whatsapp_invalid', enrollment_id: INPUT.enrollmentId }),
      }),
    );
    expect(notif.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'sdr-1', resource_id: INPUT.leadId, type: 'integration_error' }),
    );
  });

  it('último passo da cadência também pausa (não encerra)', async () => {
    currentStepOrder = 2;
    steps = [
      { step_order: 1, channel: 'email' },
      { step_order: 2, channel: 'whatsapp' },
    ];

    await reportWhatsAppInvalid(INPUT);

    expect(enrollmentUpdates()[0]?.payload).toEqual({ status: 'paused' });
  });

  it('input inválido não toca no banco', async () => {
    const result = await reportWhatsAppInvalid({ ...INPUT, leadId: 'não-uuid' });

    expect(result).toEqual({ success: false, error: 'Dados inválidos' });
    expect(captured).toHaveLength(0);
  });
});
