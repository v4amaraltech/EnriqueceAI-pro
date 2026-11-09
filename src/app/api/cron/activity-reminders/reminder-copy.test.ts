import { describe, expect, it } from 'vitest';

import { activityReminderCopy } from './reminder-copy';

describe('activityReminderCopy', () => {
  // Cron em UTC, 09/11/2026 17:25:04 BRT, retorno às 17:30 BRT.
  // O texto gravado foi "Atividade em 30min" e "agendada para 20:30".
  const scheduledAt = '2026-11-09T20:30:00.000Z';
  const now = new Date('2026-11-09T20:25:04.092Z');

  it('grava o relógio em America/Sao_Paulo e os minutos que faltam, não a janela de 30', () => {
    const copy = activityReminderCopy({
      leadName: 'Mercante Net',
      channelLabel: 'Ligação',
      scheduledAt,
      now,
    });

    expect(copy.body).toBe('Mercante Net — agendada para 17:30');
    expect(copy.body).not.toContain('20:30');
    expect(copy.title).toBe('Atividade em 5min: Ligação');
    expect(copy.title).not.toContain('30min');
  });

  it('mantém 30min quando falta mesmo meia hora', () => {
    const copy = activityReminderCopy({
      leadName: 'Mercante Net',
      channelLabel: 'Ligação',
      scheduledAt,
      now: new Date('2026-11-09T20:00:00.000Z'),
    });

    expect(copy.title).toBe('Atividade em 30min: Ligação');
    expect(copy.body).toBe('Mercante Net — agendada para 17:30');
  });

  it('não promete minutos quando o horário já chegou', () => {
    const copy = activityReminderCopy({
      leadName: 'Mercante Net',
      channelLabel: 'Ligação',
      scheduledAt,
      now: new Date('2026-11-09T20:30:10.000Z'),
    });

    expect(copy.title).toBe('Atividade agora: Ligação');
  });
});
