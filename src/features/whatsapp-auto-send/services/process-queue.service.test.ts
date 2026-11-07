import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeSupabase, eqValue, type RecordedQuery } from './test-helpers';

vi.mock('@/lib/supabase/service', () => ({ createServiceRoleClient: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    auth: {
      admin: {
        getUserById: vi.fn(() =>
          Promise.resolve({ data: { user: { email: 'sdr@x.com', user_metadata: { full_name: 'Ana SDR' } } } }),
        ),
      },
    },
  }),
}));
vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotification: vi.fn(() => Promise.resolve({ id: 'n1' })),
  createNotificationsForOrgMembers: vi.fn(() => Promise.resolve()),
}));
vi.mock('@/features/integrations/services/whatsapp-evolution.service', () => ({
  EvolutionWhatsAppService: { sendFromUserInstance: vi.fn() },
}));
vi.mock('@/features/integrations/services/whatsapp-credit.service', () => ({
  WhatsAppCreditService: { checkAndDeductCredit: vi.fn(() => Promise.resolve({ allowed: true })) },
}));
vi.mock('@/features/ai/services/ai.service', () => ({
  AIService: { personalizeMessage: vi.fn() },
}));
vi.mock('@/features/leads/actions/log-lead-event', () => ({ logLeadEvent: vi.fn() }));
vi.mock('@/features/leads/actions/mark-contacted', () => ({ markLeadContacted: vi.fn(() => Promise.resolve()) }));
vi.mock('@/features/cadences/services/cadence-end-loss.service', () => ({
  markLeadLostOnCadenceEnd: vi.fn(() => Promise.resolve({})),
}));

import { createNotification, createNotificationsForOrgMembers } from '@/features/notifications/services/notification.service';
import { EvolutionWhatsAppService } from '@/features/integrations/services/whatsapp-evolution.service';

import { processSender, tripBrake, type InstanceRow } from './process-queue.service';

// Segunda-feira 10h BRT
const NOW = new Date('2026-11-09T13:00:00Z');
const SDR = 'sdr-1';
const ORG = 'org-1';

const instance = (over: Partial<InstanceRow> = {}): InstanceRow => ({
  id: 'inst-1',
  org_id: ORG,
  user_id: SDR,
  status: 'connected',
  auto_send_daily_limit: 30,
  auto_send_limit_changed_on: '2026-11-09',
  auto_send_next_at: null,
  auto_send_consecutive_failures: 0,
  auto_send_paused_at: null,
  ...over,
});

const ITEM = {
  id: 'item-1',
  org_id: ORG,
  sender_user_id: SDR,
  lead_id: 'lead-1',
  enrollment_id: 'enr-1',
  cadence_id: 'cad-1',
  step_id: 'step-2',
  attempts: 0,
};

interface Scenario {
  pendingItem?: typeof ITEM | null;
  sentTodayCounted?: number;
  leadRepliedEver?: boolean;
  repliedInCadence?: boolean;
  unanswered?: number;
  currentStep?: number;
  leadOwner?: string | null;
  slotFree?: boolean;
  pauseApplies?: boolean;
}

function scenario(s: Scenario = {}) {
  const {
    pendingItem = ITEM,
    sentTodayCounted = 0,
    leadRepliedEver = false,
    repliedInCadence = false,
    unanswered = 0,
    currentStep = 2,
    leadOwner = SDR,
    slotFree = true,
    pauseApplies = true,
  } = s;

  return createFakeSupabase((q: RecordedQuery) => {
    if (q.table === 'whatsapp_send_queue') {
      if (q.op === 'select' && q.single) return { data: pendingItem };
      if (q.op === 'select') return { count: sentTodayCounted };
      if (q.op === 'update' && eqValue(q, 'status') === 'pending' && (q.payload as { status?: string }).status === 'sending') {
        return { data: [{ id: ITEM.id }] };
      }
      if (q.op === 'update') return { data: [{ id: ITEM.id }] };
    }
    if (q.table === 'whatsapp_instances' && q.op === 'update') {
      const p = q.payload as Record<string, unknown>;
      if ('auto_send_paused_at' in p) return { data: pauseApplies ? [{ id: 'inst-1' }] : [] };
      if ('auto_send_next_at' in p && q.filters.some((f) => f[0] === 'or')) return { data: slotFree ? [{ id: 'inst-1' }] : [] };
      return {};
    }
    if (q.table === 'interactions' && q.op === 'select') {
      const type = eqValue(q, 'type');
      if (type === 'replied' && eqValue(q, 'cadence_id')) return { data: repliedInCadence ? { id: 'r1' } : null };
      if (type === 'replied' && q.filters.some((f) => f[0] === 'order')) return { data: null };
      if (type === 'replied') return { data: leadRepliedEver ? { id: 'r0' } : null };
      if (type === 'sent') return { count: unanswered };
    }
    if (q.table === 'interactions' && q.op === 'insert') return { data: { id: 'int-1' } };
    if (q.table === 'cadence_enrollments') {
      return { data: { id: 'enr-1', status: 'active', current_step: currentStep, cadence: { status: 'active' } } };
    }
    if (q.table === 'cadence_steps') {
      return {
        data: {
          id: 'step-2',
          step_order: 2,
          template_id: 'tpl-1',
          template_id_b: null,
          ab_enabled: false,
          ab_distribution: 50,
          ab_winner_variant: null,
          ai_personalization: false,
        },
      };
    }
    if (q.table === 'leads' && q.op === 'select') {
      return {
        data: {
          id: 'lead-1',
          org_id: ORG,
          nome_fantasia: 'Acme',
          razao_social: 'Acme LTDA',
          cnpj: '00',
          email: null,
          telefone: '11999998888',
          porte: null,
          first_name: 'João',
          last_name: null,
          socios: null,
          phones: null,
          endereco: null,
          segmento: 'Indústria',
          assigned_to: leadOwner,
          whatsapp_invalid_at: null,
        },
      };
    }
    if (q.table === 'message_templates') return { data: { id: 'tpl-1', body: 'Oi {{primeiro_nome}}, aqui é {{nome_vendedor}}.' } };
    return {};
  });
}

const send = vi.mocked(EvolutionWhatsAppService.sendFromUserInstance);

beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({ success: true, messageId: 'wamid-1' });
});

const updatesOf = (queries: RecordedQuery[], table: string) =>
  queries.filter((q) => q.table === table && q.op === 'update').map((q) => q.payload as Record<string, unknown>);

describe('processSender', () => {
  it('envia pelo número do SDR, grava na timeline como automático e avança a cadência (critérios 1, 10, 16)', async () => {
    const fake = scenario();
    const outcome = await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance());

    expect(outcome).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    const args = send.mock.calls[0]![1];
    expect(args).toMatchObject({ orgId: ORG, userId: SDR, to: '11999998888', body: 'Oi João, aqui é Ana SDR.' });
    expect(args.delayMs).toBeGreaterThanOrEqual(3_000);
    expect(args.delayMs).toBeLessThanOrEqual(8_000);

    const insert = fake.queries.find((q) => q.table === 'interactions' && q.op === 'insert');
    expect(insert?.payload).toMatchObject({
      channel: 'whatsapp',
      type: 'sent',
      step_id: 'step-2',
      performed_by: SDR,
      metadata: { auto_send: true, queue_item_id: 'item-1' },
    });
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual(
      expect.objectContaining({ status: 'sent', external_id: 'wamid-1', counts_toward_limit: true }),
    );
    expect(fake.rpc).toHaveBeenCalledWith('advance_enrollment_after_step', {
      p_enrollment_id: 'enr-1',
      p_executed_step_id: 'step-2',
      p_performed_by: SDR,
    });
  });

  it('para no limite diário e não reserva a vez do número (critério 3)', async () => {
    const fake = scenario({ sentTodayCounted: 30 });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('blocked');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toEqual([]);
  });

  it('lead que já respondeu no WhatsApp passa mesmo com o limite cheio e não conta (critério 3)', async () => {
    const fake = scenario({ sentTodayCounted: 30, leadRepliedEver: true });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('sent');
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual(
      expect.objectContaining({ status: 'sent', counts_toward_limit: false }),
    );
  });

  it('respeita o intervalo: com o próximo envio no futuro, não envia (critério 4)', async () => {
    const fake = scenario();
    const outcome = await processSender(
      fake.client,
      NOW,
      { userId: SDR, orgId: ORG },
      instance({ auto_send_next_at: '2026-11-09T13:04:00Z' }),
    );
    expect(outcome).toBe('blocked');
    expect(send).not.toHaveBeenCalled();
  });

  it('outra rodada já reservou a vez: não envia em dobro', async () => {
    const fake = scenario({ slotFree: false });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('busy');
    expect(send).not.toHaveBeenCalled();
  });

  it('SDR sem número próprio: nada sai por outro número, itens voltam para a fila manual e o SDR é avisado (critério 5)', async () => {
    const fake = scenario();
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, undefined)).toBe('not_sent');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toEqual([{ status: 'failed', reason: 'no_instance' }]);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ user_id: SDR }));
  });

  it('número desconectado aciona o freio (critérios 5 e 6)', async () => {
    const fake = scenario();
    expect(
      await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance({ status: 'disconnected' })),
    ).toBe('paused');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toContainEqual(
      expect.objectContaining({ auto_send_pause_reason: 'WhatsApp desconectado', auto_send_daily_limit: 20 }),
    );
  });

  it('número pausado não envia nada', async () => {
    const fake = scenario();
    expect(
      await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance({ auto_send_paused_at: '2026-11-09T12:00:00Z' })),
    ).toBe('paused');
    expect(send).not.toHaveBeenCalled();
  });

  it('inscrição que andou de passo cancela o item e devolve a vez do número', async () => {
    const fake = scenario({ currentStep: 3 });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('canceled');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual({ status: 'canceled', reason: 'stale' });
    // devolve auto_send_next_at ao valor anterior
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toContainEqual({ auto_send_next_at: null });
  });

  it('lead que respondeu na cadência cancela o envio (critério 7)', async () => {
    const fake = scenario({ repliedInCadence: true });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('canceled');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual({ status: 'canceled', reason: 'replied' });
  });

  it('lead trocou de dono: o item passa para a fila do novo SDR', async () => {
    const fake = scenario({ leadOwner: 'sdr-2' });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('canceled');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual(
      expect.objectContaining({ status: 'pending', sender_user_id: 'sdr-2' }),
    );
  });

  it('3 mensagens sem resposta: pula o passo, registra e avança (critério 8)', async () => {
    const fake = scenario({ unanswered: 3 });
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual({ status: 'skipped', reason: 'max_unanswered' });
    const system = fake.queries.find((q) => q.table === 'interactions' && q.op === 'insert');
    expect(system?.payload).toMatchObject({ channel: 'system', metadata: { system_event: 'step_skipped_auto' } });
    expect(fake.rpc).toHaveBeenCalledWith('advance_enrollment_after_step', expect.anything());
  });

  it('destino sem WhatsApp: marca o lead como "Não é WhatsApp" e não conta como falha do número', async () => {
    send.mockResolvedValue({ success: false, error: 'Esse número não está cadastrado no WhatsApp' });
    const fake = scenario();
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('attempted');
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual({ status: 'failed', reason: 'invalid_number' });
    expect(updatesOf(fake.queries, 'leads')).toContainEqual(expect.objectContaining({ whatsapp_invalid_at: expect.any(String) }));
    expect(updatesOf(fake.queries, 'whatsapp_instances').some((p) => 'auto_send_consecutive_failures' in p)).toBe(false);
  });

  it('3ª falha seguida no número aciona o freio (critério 6)', async () => {
    send.mockResolvedValue({ success: false, error: 'Evolution API error: 500' });
    const fake = scenario();
    expect(
      await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance({ auto_send_consecutive_failures: 2 })),
    ).toBe('attempted');
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual(
      expect.objectContaining({ status: 'pending' }),
    );
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toContainEqual(
      expect.objectContaining({ auto_send_pause_reason: '3 falhas seguidas de envio' }),
    );
  });

  it('Evolution informa sessão caída: item volta para a fila e o número pausa', async () => {
    send.mockResolvedValue({ success: false, code: 'disconnected', error: 'WhatsApp do SDR não está conectado' });
    const fake = scenario();
    expect(await processSender(fake.client, NOW, { userId: SDR, orgId: ORG }, instance())).toBe('not_sent');
    expect(updatesOf(fake.queries, 'whatsapp_send_queue')).toContainEqual({ status: 'pending', attempts: 0 });
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toContainEqual(
      expect.objectContaining({ auto_send_pause_reason: 'WhatsApp desconectado' }),
    );
  });
});

describe('tripBrake', () => {
  it('avisa SDR e gestores só na primeira vez que pausa (critério 6)', async () => {
    const first = scenario({ pauseApplies: true });
    await tripBrake(first.client, instance(), NOW, 'teste');
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotificationsForOrgMembers).toHaveBeenCalledWith(expect.objectContaining({ roleFilter: 'manager' }));

    vi.clearAllMocks();
    const again = scenario({ pauseApplies: false });
    await tripBrake(again.client, instance(), NOW, 'teste');
    expect(createNotification).not.toHaveBeenCalled();
    expect(createNotificationsForOrgMembers).not.toHaveBeenCalled();
  });

  it('volta o limite um degrau (critério 9)', async () => {
    const fake = scenario();
    await tripBrake(fake.client, instance({ auto_send_daily_limit: 50 }), NOW, 'teste');
    expect(updatesOf(fake.queries, 'whatsapp_instances')).toContainEqual(
      expect.objectContaining({ auto_send_daily_limit: 40, auto_send_limit_changed_on: '2026-11-09' }),
    );
  });
});
