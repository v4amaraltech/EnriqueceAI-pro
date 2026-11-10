import { describe, expect, it } from 'vitest';

import { CHAT_COPY } from './constants';
import {
  deliveryLabel,
  statusTick,
  storedLeadMessageToChat,
  formatChatDay,
  formatChatTime,
  groupByDay,
  groupEmailThreads,
  mergeOlder,
  plainText,
  toChatMessage,
  type ChatSourceRow,
} from './model';

const row = (over: Partial<ChatSourceRow> = {}): ChatSourceRow => ({
  id: '11111111-1111-4111-8111-111111111111',
  type: 'sent',
  channel: 'whatsapp',
  message_content: 'Olá',
  metadata: null,
  ai_generated: false,
  created_at: '2026-11-10T15:30:00.000Z',
  ...over,
});

describe('conversa do canal', () => {
  it('não usa travessão nos textos', () => {
    for (const text of Object.values(CHAT_COPY)) {
      expect(text).not.toMatch(/[—–]/);
    }
  });

  it('coloca o que enviamos à direita e a resposta à esquerda, com um único estado', () => {
    expect(toChatMessage(row())?.direction).toBe('out');
    expect(toChatMessage(row())?.delivery).toBe('Enviada');
    expect(toChatMessage(row({ type: 'delivered' }))?.delivery).toBe('Entregue');
    expect(toChatMessage(row({ type: 'opened' }))?.delivery).toBe('Lida');
    expect(deliveryLabel('email', 'opened')).toBe('Aberta');
    expect(toChatMessage(row({ type: 'failed' }))?.delivery).toBe('Falhou');

    const reply = toChatMessage(row({ type: 'replied', message_content: null }));
    expect(reply?.direction).toBe('in');
    expect(reply?.delivery).toBeNull();
    expect(reply?.text).toBe(CHAT_COPY.missingReply);
    expect(reply?.missingBody).toBe(true);
  });

  it('ignora reunião e evento de sistema, e tira HTML do corpo', () => {
    expect(toChatMessage(row({ type: 'meeting_scheduled' }))).toBeNull();
    expect(toChatMessage(row({ metadata: { system_event: 'cadence_enrolled' } }))).toBeNull();
    const html = toChatMessage(row({
      channel: 'email',
      message_content: null,
      metadata: { html_body: '<p>Oi <script>alert(1)</script></p>', thread_id: 'th-1', subject: 'Proposta' },
    }));
    expect(html?.text).toBe('Oi');
    expect(html?.html).toContain('<p>');
    expect(html?.html).not.toMatch(/script|alert/i);
    expect(html?.threadId).toBe('th-1');
    expect(html?.subject).toBe('Proposta');
    expect(plainText('<b>A&amp;B</b>')).toBe('A&B');

    const rich = toChatMessage(row({
      channel: 'email',
      message_content: 'texto plano que não deve ganhar',
      metadata: {
        html_body: '<p>Olá Sandro, tudo bem?</p><p>Att,<br><strong>Vinicius Mercante</strong><br><a href="https://v4company.com">https://v4company.com</a></p>',
      },
    }));
    expect(rich?.text).toContain('Vinicius Mercante');
    expect(rich?.html).toContain('<strong>Vinicius Mercante</strong>');
    expect(rich?.html).toContain('href="https://v4company.com"');
    expect(rich?.html).toContain('rel="noopener noreferrer"');
    expect(rich?.html).not.toContain('texto plano');

    const lines = toChatMessage(row({
      channel: 'whatsapp',
      message_content: 'Oi Lucas\n\nTudo bem?\nhttps://v4company.com',
    }));
    expect(lines?.text).toContain('\n\n');
    expect(lines?.html).toContain('<br>');
    expect(lines?.html).toContain('href="https://v4company.com"');
  });

  it('agrupa e-mail pelo thread e separa o dia em Brasília', () => {
    const first = toChatMessage(row({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      channel: 'email',
      created_at: '2026-11-10T02:30:00.000Z',
      metadata: { thread_id: 'th-1', subject: 'Proposta' },
    }))!;
    const second = toChatMessage(row({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      channel: 'email',
      type: 'replied',
      message_content: 'pode ser',
      created_at: '2026-11-10T18:00:00.000Z',
      metadata: { thread_id: 'th-1' },
    }))!;
    const loose = toChatMessage(row({
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      channel: 'email',
      message_content: 'avulsa',
      created_at: '2026-11-11T12:00:00.000Z',
    }))!;
    const threads = groupEmailThreads([loose, second, first]);
    expect(threads.map((thread) => thread.subject)).toEqual(['Mensagem sem conversa', 'Proposta']);
    expect(threads[1]?.messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(formatChatDay('2026-11-10T02:30:00.000Z')).toBe('9 de novembro de 2026');
    expect(formatChatTime('2026-11-10T15:30:00.000Z')).toBe('12:30');
    expect(groupByDay([second, first]).map((group) => group.label)).toEqual([
      '9 de novembro de 2026',
      '10 de novembro de 2026',
    ]);
  });

  it('junta a página antiga sem duplicar', () => {
    const newer = toChatMessage(row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', created_at: '2026-11-10T18:00:00.000Z' }))!;
    const older = toChatMessage(row({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', created_at: '2026-11-10T12:00:00.000Z' }))!;
    const merged = mergeOlder([newer], [older, newer]);
    expect(merged.map((message) => message.id)).toEqual([older.id, newer.id]);
  });

  it('mostra a mídia e o tique que veio do evento, sem inventar leitura', () => {
    expect(statusTick('whatsapp', 'read')).toBe('✓✓ Lida');
    expect(statusTick('email', 'sent')).toBe('✓ Enviada');
    const message = storedLeadMessageToChat({
      id: 'm1',
      channel: 'whatsapp',
      direction: 'inbound',
      body_text: null,
      body_html: null,
      subject: null,
      media: { type: 'audio' },
      thread_id: null,
      ai_generated: false,
      occurred_at: '2026-11-10T15:00:00.000Z',
    }, 'read');
    expect(message.text).toBe('Mídia: áudio');
    expect(message.delivery).toBeNull();
  });
});
