import { describe, expect, it } from 'vitest';

import { parseEvolutionUpsert } from './evolution-parse';
import { gmailReplyText } from './gmail-reply';
import { metaCloudMedia } from './meta-media';

describe('leitura da Evolution', () => {
  it('ignora grupo e status e guarda mídia sem URL', () => {
    expect(parseEvolutionUpsert({ key: { id: '1', remoteJid: '123@g.us', fromMe: false } }, null)?.skip).toBe('group');
    expect(parseEvolutionUpsert({ key: { id: '1', remoteJid: 'status@broadcast', fromMe: false } }, null)?.skip).toBe('broadcast');
    const image = parseEvolutionUpsert({
      key: { id: 'IMG1', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
      message: { imageMessage: { mimetype: 'image/jpeg', url: 'https://cdn.example/file', caption: 'foto' } },
    }, null);
    expect(image?.text).toBe('foto');
    expect(image?.media).toEqual({ type: 'image', provider_media_id: 'IMG1', mime: 'image/jpeg' });
    expect(JSON.stringify(image?.media)).not.toContain('http');
  });

  it('a mesma mensagem reenviada tem o mesmo id', () => {
    const first = parseEvolutionUpsert({ key: { id: 'MSG-A', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } }, null);
    const retry = parseEvolutionUpsert({ key: { id: 'MSG-A', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } }, '2026-11-10T12:00:00.000Z');
    expect(retry?.messageId).toBe(first?.messageId);
    expect(parseEvolutionUpsert({ key: { id: 'MSG-A', remoteJid: '5511999998888@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } }, null)?.direction).toBe('outbound');
  });
});

describe('mídia e corpo', () => {
  it('a Cloud API só anota o tipo e o id', () => {
    expect(metaCloudMedia({ id: 'wamid.1', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } })).toEqual({
      type: 'image',
      provider_media_id: 'media-1',
      mime: 'image/jpeg',
    });
    expect(metaCloudMedia({ id: 'wamid.2', type: 'text' })).toBeNull();
  });

  it('o Gmail prefere o texto e não devolve HTML cru', () => {
    const html = Buffer.from('<p>Olá &amp; time</p>').toString('base64');
    expect(gmailReplyText({ mimeType: 'text/html', body: { data: html } })).toBe('Olá & time');
    const plain = Buffer.from('resposta').toString('base64url');
    expect(gmailReplyText({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: plain } },
        { mimeType: 'text/html', body: { data: html } },
      ],
    })).toBe('resposta');
  });
});
