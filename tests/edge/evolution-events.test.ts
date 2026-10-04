import { describe, expect, it } from 'vitest';

import {
  buildEvolutionEventId,
  parseInboundMessage,
  leadPhoneMatches,
  localPhoneVariants,
} from '../../supabase/functions/_shared/evolution-events';

const INSTANCE = 'ea_c2727473_3e0deabd_a7jx';

const upsert = (id: string, extra: Record<string, unknown> = {}) => ({
  event: 'messages.upsert',
  instance: INSTANCE,
  date_time: '2026-10-04T12:37:46.222Z',
  data: { key: { id, remoteJid: '5511999998888@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' }, ...extra },
});

describe('buildEvolutionEventId', () => {
  it('duas mensagens diferentes no mesmo date_time NÃO colidem (usa o id do WhatsApp)', () => {
    const a = buildEvolutionEventId(INSTANCE, 'messages.upsert', upsert('MSG-A'));
    const b = buildEvolutionEventId(INSTANCE, 'messages.upsert', upsert('MSG-B'));
    expect(a).not.toBe(b);
    expect(a).toBe(`${INSTANCE}_messages.upsert_MSG-A`);
  });

  it('reenvio da mesma mensagem gera o mesmo id (deduplica)', () => {
    const first = buildEvolutionEventId(INSTANCE, 'messages.upsert', upsert('MSG-A'));
    const retry = buildEvolutionEventId(INSTANCE, 'messages.upsert', { ...upsert('MSG-A'), date_time: '2026-10-04T12:40:00.000Z' });
    expect(retry).toBe(first);
  });

  it('messages.update distingue os status da mesma mensagem', () => {
    const delivered = buildEvolutionEventId(INSTANCE, 'messages.update', { data: { keyId: 'MSG-A', status: 'DELIVERY_ACK' } });
    const read = buildEvolutionEventId(INSTANCE, 'messages.update', { data: { keyId: 'MSG-A', status: 'READ' } });
    expect(delivered).not.toBe(read);
  });

  it('aceita data em array e em {messages}', () => {
    const arr = buildEvolutionEventId(INSTANCE, 'MESSAGES_UPSERT', { data: [{ key: { id: 'X1' } }] });
    const wrapped = buildEvolutionEventId(INSTANCE, 'MESSAGES_UPSERT', { data: { messages: [{ key: { id: 'X1' } }] } });
    expect(arr).toBe(`${INSTANCE}_MESSAGES_UPSERT_X1`);
    expect(wrapped).toBe(arr);
  });

  it('eventos de conexão continuam usando date_time', () => {
    expect(buildEvolutionEventId(INSTANCE, 'connection.update', { date_time: 'T1', data: { state: 'open' } })).toBe(
      `${INSTANCE}_connection.update_T1`,
    );
  });
});

describe('parseInboundMessage', () => {
  it('lê a resposta do lead', () => {
    expect(parseInboundMessage(upsert('MSG-A').data)).toEqual({
      phone: '5511999998888',
      text: 'oi',
      messageId: 'MSG-A',
      pushName: null,
    });
  });

  it('ignora mensagem enviada por nós, grupo e status', () => {
    expect(parseInboundMessage({ key: { id: '1', remoteJid: '5511@s.whatsapp.net', fromMe: true } })).toBeNull();
    expect(parseInboundMessage({ key: { id: '1', remoteJid: '123-456@g.us' } })).toBeNull();
    expect(parseInboundMessage({ key: { id: '1', remoteJid: 'status@broadcast' } })).toBeNull();
  });
});

describe('localPhoneVariants', () => {
  it('celular com 9: forma enviada + sem o 9', () => {
    expect(localPhoneVariants('5511999998888')).toEqual(['11999998888', '1199998888']);
  });

  it('celular SEM o 9 (WhatsApp às vezes manda assim): forma enviada + com o 9', () => {
    expect(localPhoneVariants('551199998888')).toEqual(['1199998888', '11999998888']);
  });

  it('fixo (começa com 2–5) não ganha 9', () => {
    expect(localPhoneVariants('551932582600')).toEqual(['1932582600']);
  });

  it('sem 55 e com formatação', () => {
    expect(localPhoneVariants('(11) 99999-8888')).toEqual(['11999998888', '1199998888']);
  });

  it('curto demais (sem DDD) → nada', () => {
    expect(localPhoneVariants('99998888')).toEqual([]);
  });

  it('estrangeiro ou @lid (12+ dígitos locais) → nada', () => {
    expect(localPhoneVariants('351912345678')).toEqual([]);
    expect(localPhoneVariants('123456789012345')).toEqual([]);
  });
});

describe('leadPhoneMatches', () => {
  const v = localPhoneVariants('5511999998888'); // ['11999998888', '1199998888']

  it('telefone formatado, com 55, sem o 9 ou em phones[] casam', () => {
    expect(leadPhoneMatches('(11) 99999-8888', null, v)).toBe(true);
    expect(leadPhoneMatches('+55 11 99999-8888', null, v)).toBe(true);
    expect(leadPhoneMatches('1199998888', null, v)).toBe(true);
    expect(leadPhoneMatches(null, [{ tipo: 'celular', numero: '5511999998888' }], v)).toBe(true);
  });

  it('outro DDD com os mesmos últimos dígitos NÃO casa', () => {
    expect(leadPhoneMatches('(51) 99999-8888', [], v)).toBe(false);
    expect(leadPhoneMatches('(19) 9999-8888', [], v)).toBe(false);
  });
});

describe('parseInboundMessage — mensagens que não são resposta', () => {
  const base = { key: { id: '1', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false } };
  it.each(['reactionMessage', 'protocolMessage', 'editedMessage', 'pollUpdateMessage'])('ignora %s', (type) => {
    expect(parseInboundMessage({ ...base, message: { [type]: {} } })).toBeNull();
  });

  it('áudio/figurinha sem texto ainda conta como resposta (texto vazio)', () => {
    expect(parseInboundMessage({ ...base, message: { audioMessage: {} } })).toMatchObject({ text: '' });
  });
});
