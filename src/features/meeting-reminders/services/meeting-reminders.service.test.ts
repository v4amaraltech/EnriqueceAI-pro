import { describe, expect, it } from 'vitest';

import type { ReminderDueRow } from '../types';
import {
  buildLinkLine,
  buildReminderContent,
  escapeHtmlValue,
  formatMeetingDateBRT,
  formatMeetingTimeBRT,
  isQuietHoursBRT,
} from './meeting-reminders.service';

function makeRow(overrides: Partial<ReminderDueRow> = {}): ReminderDueRow {
  return {
    org_id: 'org-1',
    lead_id: 'lead-1',
    sdr_user_id: 'sdr-1',
    first_name: 'Maria',
    last_name: 'Souza',
    razao_social: 'ACME LTDA',
    nome_fantasia: 'ACME',
    email: 'maria@acme.com',
    meeting_scheduled_at: '2026-07-10T12:00:00Z',
    meeting_starts_at: '2026-07-13T12:15:00Z', // 09:15 BRT, segunda-feira
    meet_link: 'https://meet.google.com/abc-defg-hij',
    calendar_event_id: 'evt-1',
    reminder_step_id: 'step-1',
    context: 'inbound',
    step_order: 1,
    channel: 'email',
    message_template_id: 'tpl-1',
    fire_at: '2026-07-10T12:00:00Z',
    ...overrides,
  };
}

describe('isQuietHoursBRT', () => {
  it('marca quiet antes das 8h BRT', () => {
    expect(isQuietHoursBRT(new Date('2026-07-13T10:59:00Z'))).toBe(true); // 07:59 BRT
  });
  it('libera às 8h BRT', () => {
    expect(isQuietHoursBRT(new Date('2026-07-13T11:00:00Z'))).toBe(false); // 08:00 BRT
  });
  it('libera às 20h BRT', () => {
    expect(isQuietHoursBRT(new Date('2026-07-13T23:00:00Z'))).toBe(false); // 20:00 BRT
  });
  it('marca quiet às 21h BRT', () => {
    expect(isQuietHoursBRT(new Date('2026-07-14T00:00:00Z'))).toBe(true); // 21:00 BRT
  });
});

describe('formatMeeting*BRT', () => {
  it('formata a hora no fuso de Brasília', () => {
    expect(formatMeetingTimeBRT('2026-07-13T12:15:00Z')).toBe('09:15');
  });
  it('formata a data no fuso de Brasília', () => {
    const s = formatMeetingDateBRT('2026-07-13T12:15:00Z');
    expect(s).toContain('13/07');
    expect(s.toLowerCase()).toContain('segunda');
  });
});

describe('buildLinkLine', () => {
  it('monta a linha com URL https', () => {
    const line = buildLinkLine('https://meet.google.com/abc-defg-hij');
    expect(line).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(line).toContain('Google Meet');
  });
  it('retorna vazio sem link', () => {
    expect(buildLinkLine(null)).toBe('');
    expect(buildLinkLine(undefined)).toBe('');
  });
  it('rejeita esquemas não-https (anti-injeção)', () => {
    expect(buildLinkLine('http://x.com')).toBe('');
    expect(buildLinkLine('javascript:alert(1)')).toBe('');
    expect(buildLinkLine('https://x.com" onmouseover="x')).toBe('');
  });
});

describe('escapeHtmlValue', () => {
  it('escapa caracteres HTML', () => {
    expect(escapeHtmlValue('<b>&"\'')).toBe('&lt;b&gt;&amp;&quot;&#39;');
  });
});

describe('buildReminderContent', () => {
  const template = {
    subject: 'Reunião — {{data_reuniao}} às {{hora_reuniao}}',
    body: '<p>Oi {{primeiro_nome}}, da {{empresa}}</p>\n{{link_reuniao_linha}}\n<p>{{nome_vendedor}}</p>',
  };

  it('renderiza assunto e corpo com o link injetado', () => {
    const { subject, htmlBody } = buildReminderContent(makeRow(), template, 'Ismael');
    expect(subject).toBe('Reunião — segunda-feira, 13/07 às 09:15');
    expect(htmlBody).toContain('Oi Maria, da ACME LTDA');
    expect(htmlBody).toContain('href="https://meet.google.com/abc-defg-hij"');
    expect(htmlBody).toContain('Ismael');
    expect(htmlBody).not.toContain('{{'); // sem placeholder órfão
  });

  it('escapa valores vindos do lead (anti-injeção HTML)', () => {
    const row = makeRow({ first_name: '<script>', razao_social: 'A<b>&Co' });
    const { htmlBody } = buildReminderContent(row, template, 'Ismael');
    expect(htmlBody).toContain('&lt;script&gt;');
    expect(htmlBody).not.toContain('<script>');
  });

  it('omite a linha do link quando não há Meet', () => {
    const { htmlBody } = buildReminderContent(makeRow({ meet_link: null }), template, 'Ismael');
    expect(htmlBody).not.toContain('Google Meet');
    expect(htmlBody).not.toContain('{{link_reuniao_linha}}');
  });
});
