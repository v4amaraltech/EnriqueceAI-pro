import { describe, expect, it } from 'vitest';

import { isInternalChannelLog, isLeadConversation } from './audience';

const LEAD_PHONE = '11988887777';
const CLOSER_PHONE = '11945705316';

describe('conversa só com o lead', () => {
  it('reconhece o pedido de feedback ao closer, com ou sem metadado', () => {
    expect(isInternalChannelLog(
      { source: 'closer_feedback', recipient_kind: 'closer', recipient: CLOSER_PHONE },
      'WhatsApp de solicitação de feedback enviado para Vinicius Mercante',
    )).toBe(true);
    expect(isInternalChannelLog(null, 'Email de solicitação de feedback falhou para Ana')).toBe(true);
    expect(isInternalChannelLog({ system_event: 'step_skipped' }, 'oi')).toBe(true);
    expect(isInternalChannelLog(null, 'Oi Roberta, tudo bem?')).toBe(false);
  });

  it('fica com o texto da cadência e descarta o número do closer', () => {
    const base = {
      channel: 'whatsapp' as const,
      leadPhones: [LEAD_PHONE],
      leadEmails: ['lead@acme.com'],
      phonesKnown: true,
      emailsKnown: true,
    };
    expect(isLeadConversation({ ...base, content: 'Oi Roberta', metadata: null })).toBe(true);
    expect(isLeadConversation({
      ...base,
      content: 'oi',
      metadata: { recipient: '5511988887777' },
    })).toBe(true);
    expect(isLeadConversation({
      ...base,
      content: 'WhatsApp de solicitação de feedback enviado para Vinicius Mercante',
      metadata: { source: 'closer_feedback', recipient_kind: 'closer', recipient: CLOSER_PHONE },
    })).toBe(false);
    expect(isLeadConversation({
      ...base,
      content: 'oi',
      explicitAddress: CLOSER_PHONE,
    })).toBe(false);
    expect(isLeadConversation({
      ...base,
      phonesKnown: false,
      content: 'oi',
      explicitAddress: CLOSER_PHONE,
    })).toBe(true);
  });
});
