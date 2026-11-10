import { describe, expect, it } from 'vitest';

import { legacyInteractionToMessage, type LegacyInteraction } from './backfill';

const row = (over: Partial<LegacyInteraction> = {}): LegacyInteraction => ({
  id: '11111111-1111-4111-8111-111111111111',
  org_id: 'org-1',
  lead_id: 'lead-1',
  channel: 'email',
  type: 'replied',
  message_content: null,
  external_id: null,
  metadata: { thread_id: 'th-1', html_body: '<p>oi</p>' },
  ai_generated: false,
  performed_by: null,
  created_at: '2026-11-01T12:00:00.000Z',
  ...over,
});

describe('cópia das interactions antigas', () => {
  it('marca o provedor legado e não copia ligação nem evento de sistema', () => {
    const copied = legacyInteractionToMessage(row());
    expect(copied).toMatchObject({
      provider: 'legacy_interactions',
      direction: 'inbound',
      provider_message_id: 'interaction:11111111-1111-4111-8111-111111111111',
      thread_id: 'th-1',
      body_html: '<p>oi</p>',
      status: null,
    });
    expect(legacyInteractionToMessage(row({ channel: 'phone', type: 'sent' }))).toBeNull();
    expect(legacyInteractionToMessage(row({ metadata: { system_event: 'step_skipped' } }))).toBeNull();
    expect(legacyInteractionToMessage(row({
      channel: 'whatsapp',
      type: 'sent',
      message_content: 'WhatsApp de solicitação de feedback enviado para Vinicius Mercante',
      metadata: { source: 'closer_feedback', recipient_kind: 'closer', recipient: '11945705316' },
    }))).toBeNull();
  });

  it('é idempotente pelo id externo e traduz o status sem baixar mídia', () => {
    const opened = legacyInteractionToMessage(row({
      channel: 'whatsapp',
      type: 'opened',
      external_id: 'wamid.1',
      message_content: 'olá',
    }));
    expect(opened).toMatchObject({
      direction: 'outbound',
      provider_message_id: 'wamid.1',
      status: 'read',
      body_text: 'olá',
    });
    expect(legacyInteractionToMessage(row({ channel: 'email', type: 'opened', external_id: 'gm1' }))?.status).toBeNull();
    expect(legacyInteractionToMessage(row({ type: 'bounced', external_id: 'gm2' }))?.status).toBe('failed');
  });
});
