import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const createNotification = vi.fn();
const mockFrom = vi.fn();

vi.mock('@/lib/auth/verify-cron-secret', () => ({
  verifyCronSecret: () => true,
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceRoleClient: () => ({ from: mockFrom }),
}));

vi.mock('@/lib/supabase/from', () => ({
  from: (client: { from: (table: string) => unknown }, table: string) => client.from(table),
}));

vi.mock('@/features/notifications/services/notification.service', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
}));

vi.mock('@/features/integrations/services/whatsapp-evolution.service', () => ({
  EvolutionWhatsAppService: { sendMessage: vi.fn() },
}));

import { POST } from './route';

const ACTIVITY_ID = 'def69798-ffba-42cb-a5d3-1e70cac71ffd';
const LEAD_ID = '969ea854-1724-4f22-85a3-3633cd314553';
const VINICIUS_ID = 'c6213fe4-manager-vinicius';
const ORG_ID = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

function chain(result: unknown) {
  const target: Record<string, unknown> = {};
  const self = () => target;
  for (const method of ['select', 'update', 'eq', 'is', 'lte', 'lt', 'gte', 'in', 'order', 'not']) {
    target[method] = vi.fn(self);
  }
  target.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return target;
}

describe('POST /api/cron/activity-reminders', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    createNotification.mockReset();
    createNotification.mockResolvedValue({ id: 'f9a36c58-55e6-4c41-a506-51bc5f8fa3e5' });
    mockFrom.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T20:25:04.092Z'));
  });

  it('persiste 17:30 e 5min para o retorno criado dentro da janela de 30', async () => {
    const activity = {
      id: ACTIVITY_ID,
      org_id: ORG_ID,
      user_id: VINICIUS_ID,
      lead_id: LEAD_ID,
      channel: 'phone',
      kind: 'return',
      scheduled_at: '2026-11-09T20:30:00.000Z',
      notes: 'Teste E2E cockpit Mercante Net',
    };
    let scheduledReads = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === 'scheduled_activities') {
        scheduledReads += 1;
        if (scheduledReads === 1) return chain({ data: [activity] });
        if (scheduledReads === 2) return chain({ data: [{ id: ACTIVITY_ID }] });
        return chain({ data: [] });
      }
      if (table === 'leads') {
        return chain({ data: [{ id: LEAD_ID, nome_fantasia: 'Mercante Net', razao_social: null }] });
      }
      return chain({ data: [] });
    });

    const response = await POST(new Request('http://localhost/api/cron/activity-reminders', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      org_id: ORG_ID,
      user_id: VINICIUS_ID,
      type: 'activity_reminder',
      title: 'Atividade em 5min: Ligação',
      body: 'Mercante Net — agendada para 17:30',
      resource_id: LEAD_ID,
      metadata: { scheduled_activity_id: ACTIVITY_ID, channel: 'phone' },
    }));
  });
});
