import { describe, expect, it } from 'vitest';

import { buildCockpit, queueReasonLabel, type CockpitInstanceRow, type CockpitQueueItemRow } from './cockpit-summary';

// Segunda 10h BRT; dia BRT começa 03:00Z
const NOW = new Date('2026-11-09T13:00:00Z');

const inst = (userId: string, over: Partial<CockpitInstanceRow> = {}): CockpitInstanceRow => ({
  id: `inst-${userId}`,
  user_id: userId,
  phone: '5511999990000',
  status: 'connected',
  auto_send_daily_limit: 20,
  auto_send_next_at: null,
  auto_send_paused_at: null,
  auto_send_pause_reason: null,
  ...over,
});

let seq = 0;
const item = (sender: string, status: string, over: Partial<CockpitQueueItemRow> = {}): CockpitQueueItemRow => ({
  id: `item-${++seq}`,
  sender_user_id: sender,
  lead_id: `lead-${seq}`,
  status,
  reason: null,
  counts_toward_limit: true,
  sent_at: status === 'sent' ? '2026-11-09T12:00:00Z' : null,
  created_at: '2026-11-09T11:00:00Z',
  updated_at: '2026-11-09T12:00:00Z',
  lead: { nome_fantasia: `Lead ${seq}`, razao_social: null },
  cadence: { name: 'Inbound' },
  ...over,
});

const names = new Map([
  ['sdr-a', 'Ana'],
  ['sdr-b', 'Bruno'],
]);

const instances = [inst('sdr-b'), inst('sdr-a'), inst('org-default', { user_id: null })];
const items = [
  item('sdr-a', 'sent'),
  item('sdr-a', 'sent', { counts_toward_limit: false }),
  item('sdr-a', 'sent', { sent_at: '2026-11-08T20:00:00Z' }), // ontem
  item('sdr-a', 'pending'),
  item('sdr-a', 'failed', { reason: 'no_phone' }),
  item('sdr-b', 'pending'),
  item('sdr-b', 'sent'),
];

describe('buildCockpit', () => {
  it('SDR vê só o próprio número com os números do dia (critério 12)', () => {
    const c = buildCockpit({ now: NOW, viewerId: 'sdr-a', isManager: false, instances, items, names });
    expect(c.numbers).toHaveLength(1);
    expect(c.numbers[0]).toMatchObject({
      userId: 'sdr-a',
      connected: true,
      dailyLimit: 20,
      sentTodayCounted: 1, // o de ontem e o de quem já respondeu não contam
      sentTodayTotal: 2,
      pending: 1,
      failedToday: 1,
      pausedAt: null,
    });
  });

  it('SDR nunca recebe número nem fila de outro SDR (critério 14)', () => {
    const c = buildCockpit({ now: NOW, viewerId: 'sdr-a', isManager: false, instances, items, names });
    expect(c.numbers.map((n) => n.userId)).toEqual(['sdr-a']);
    expect(c.queue.every((q) => q.userId === 'sdr-a')).toBe(true);
  });

  it('gestor vê todos os números do time, em ordem de nome, sem a instância da organização (critério 13)', () => {
    const c = buildCockpit({ now: NOW, viewerId: 'mgr', isManager: true, instances, items, names });
    expect(c.numbers.map((n) => n.userName)).toEqual(['Ana', 'Bruno']);
    expect(c.queue.map((q) => q.userId)).toContain('sdr-b');
    expect(c.ownHasNumber).toBe(false);
  });

  it('só mostra o próximo envio quando ele ainda está no futuro', () => {
    const c = buildCockpit({
      now: NOW,
      viewerId: 'sdr-a',
      isManager: false,
      instances: [inst('sdr-a', { auto_send_next_at: '2026-11-09T13:04:00Z' }), inst('sdr-b', { auto_send_next_at: '2026-11-09T12:00:00Z' })],
      items: [],
      names,
    });
    expect(c.numbers[0]?.nextAt).toBe('2026-11-09T13:04:00Z');
    const m = buildCockpit({
      now: NOW,
      viewerId: 'mgr',
      isManager: true,
      instances: [inst('sdr-b', { auto_send_next_at: '2026-11-09T12:00:00Z' })],
      items: [],
      names,
    });
    expect(m.numbers[0]?.nextAt).toBeNull();
  });

  it('mostra pausa e motivo', () => {
    const c = buildCockpit({
      now: NOW,
      viewerId: 'sdr-a',
      isManager: false,
      instances: [inst('sdr-a', { auto_send_paused_at: '2026-11-09T12:30:00Z', auto_send_pause_reason: '3 falhas seguidas' })],
      items: [],
      names,
    });
    expect(c.numbers[0]).toMatchObject({ pausedAt: '2026-11-09T12:30:00Z', pauseReason: '3 falhas seguidas' });
  });

  it('fila: pendentes primeiro, depois o que já aconteceu (mais recente primeiro)', () => {
    const c = buildCockpit({
      now: NOW,
      viewerId: 'sdr-a',
      isManager: false,
      instances: [inst('sdr-a')],
      items: [
        item('sdr-a', 'sent', { sent_at: '2026-11-09T12:10:00Z' }),
        item('sdr-a', 'pending', { created_at: '2026-11-09T11:30:00Z' }),
        item('sdr-a', 'sent', { sent_at: '2026-11-09T12:40:00Z' }),
        item('sdr-a', 'pending', { created_at: '2026-11-09T11:00:00Z' }),
      ],
      names,
    });
    expect(c.queue.map((q) => [q.status, q.at])).toEqual([
      ['pending', '2026-11-09T11:00:00Z'],
      ['pending', '2026-11-09T11:30:00Z'],
      ['sent', '2026-11-09T12:40:00Z'],
      ['sent', '2026-11-09T12:10:00Z'],
    ]);
  });

  it('SDR sem número próprio recebe painel vazio', () => {
    const c = buildCockpit({ now: NOW, viewerId: 'sdr-c', isManager: false, instances, items, names });
    expect(c.numbers).toEqual([]);
    expect(c.ownHasNumber).toBe(false);
  });
});

describe('queueReasonLabel', () => {
  it('traduz os motivos da fila', () => {
    expect(queueReasonLabel('canceled', 'replied')).toBe('O lead respondeu');
    expect(queueReasonLabel('failed', 'send_error: 500')).toMatch(/fila manual/);
    expect(queueReasonLabel('pending', 'retry: timeout')).toMatch(/tentar de novo/);
    expect(queueReasonLabel('sent', null)).toBeNull();
  });
});
