import { describe, expect, it, vi } from 'vitest';

vi.mock('@/features/cadences/services/reply-detection.service', () => ({ locateGenuineReply: vi.fn() }));
vi.mock('./flag', () => ({ isLeadMessagesCaptureEnabled: () => Promise.resolve(false) }));
vi.mock('./record', () => ({ recordLeadMessage: vi.fn() }));

import { gmailBodies, gmailReplyText } from './gmail-reply';

const b64 = (value: string) => Buffer.from(value).toString('base64url');

describe('resposta do lead no Gmail', () => {
  it('prefere text/plain e corta a citação', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: b64('Fechado, pode mandar.\r\n\r\nOn Thu, Nov 13, 2026 at 9:00 AM Ana wrote:\r\n> proposta') } },
        { mimeType: 'text/html', body: { data: b64('<div>Fechado, pode mandar.</div>') } },
      ],
    };
    expect(gmailReplyText(payload)).toBe('Fechado, pode mandar.');
    expect(gmailBodies(payload).html).toBe('<div>Fechado, pode mandar.</div>');
  });

  it('só HTML vira texto', () => {
    const payload = { mimeType: 'text/html', body: { data: b64('<p>Olá &amp; obrigado</p>') } };
    expect(gmailReplyText(payload)).toBe('Olá & obrigado');
    expect(gmailBodies(payload)).toEqual({ text: null, html: '<p>Olá &amp; obrigado</p>' });
  });

  it('HTML com citação do Gmail fica só com a resposta nova', () => {
    const html = '<div dir="ltr">Pode ligar amanhã.</div><div class="gmail_quote"><div class="gmail_attr">Em qui., 13 de nov. de 2026, Ana escreveu:</div><blockquote class="gmail_quote">mensagem antiga</blockquote></div>';
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64(html) } }] }],
    };
    expect(gmailReplyText(payload)).toBe('Pode ligar amanhã.');
  });

  it('payload vazio devolve null', () => {
    expect(gmailReplyText(undefined)).toBeNull();
    expect(gmailReplyText({ mimeType: 'text/html', body: { data: b64('<br>') } })).toBeNull();
  });
});
