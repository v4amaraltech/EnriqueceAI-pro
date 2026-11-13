import { describe, expect, it } from 'vitest';

import { htmlToText, looksLikeHtml, resolveLeadMessageBodyText, stripQuotedHtml } from './body-text';

const outbound = { channel: 'email' as const, direction: 'outbound' as const };
const inbound = { channel: 'email' as const, direction: 'inbound' as const };

describe('resolveLeadMessageBodyText', () => {
  it('o texto do provedor ganha do HTML', () => {
    expect(resolveLeadMessageBodyText({ ...outbound, bodyText: 'Oi Ana', bodyHtml: '<p>Outro</p>' })).toBe('Oi Ana');
  });

  it('HTML do template vira texto limpo com quebras', () => {
    const html = '<p>Olá Ana,</p><p>Tudo bem?<br>Segue a proposta.</p><div>Abraço</div>';
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: html })).toBe('Olá Ana,\n\nTudo bem?\nSegue a proposta.\n\nAbraço');
  });

  it('decodifica entidades', () => {
    const html = '<p>A&nbsp;&amp;&nbsp;B &lt;x&gt; &quot;c&quot; &#39;d&#39; &#233; &#x2713;</p>';
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: html })).toBe('A & B <x> "c" \'d\' é ✓');
  });

  it('ignora script e style', () => {
    const html = '<style>p{color:red}</style><script>alert(1)</script><p>Corpo</p>';
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: html })).toBe('Corpo');
  });

  it('HTML vazio ou só com tags devolve null, nunca HTML cru', () => {
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: '' })).toBeNull();
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: '<p>&nbsp;</p><br>' })).toBeNull();
    expect(resolveLeadMessageBodyText({ ...outbound, bodyText: '   ', bodyHtml: null })).toBeNull();
  });

  it('texto do provedor que já é HTML é convertido', () => {
    expect(resolveLeadMessageBodyText({ ...outbound, bodyText: '<div>Oi</div><div>tudo bem?</div>' })).toBe('Oi\ntudo bem?');
    expect(looksLikeHtml('preço < 10 e > 5')).toBe(false);
  });

  it('corta a citação do Gmail na resposta do lead', () => {
    const html = '<div dir="ltr">Pode ser terça às 10h.</div><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">Em qui., 13 de nov. de 2026 Ana escreveu:<br></div><blockquote class="gmail_quote"><p>Olá, vamos conversar?</p></blockquote></div>';
    expect(resolveLeadMessageBodyText({ ...inbound, bodyHtml: html })).toBe('Pode ser terça às 10h.');
  });

  it('corta a assinatura do Gmail na resposta do lead', () => {
    const html = '<div dir="ltr"><div>Tenho interesse.</div><div><br></div><div class="gmail_signature" data-smartmail="gmail_signature"><div>João Silva</div><div>Diretor</div></div></div>';
    expect(resolveLeadMessageBodyText({ ...inbound, bodyHtml: html })).toBe('Tenho interesse.');
  });

  it('corta a citação em texto puro da resposta', () => {
    const text = 'Pode ser terça.\n\nEm seg., 21 de set. de 2026, Ana escreveu:\n> texto antigo';
    expect(resolveLeadMessageBodyText({ ...inbound, bodyText: text })).toBe('Pode ser terça.');
  });

  it('se o corte apagar tudo, preserva o texto', () => {
    expect(resolveLeadMessageBodyText({ ...inbound, bodyText: '> só citação' })).toBe('> só citação');
    expect(resolveLeadMessageBodyText({ ...inbound, bodyHtml: '<blockquote>Texto em bloco</blockquote>' })).toBe('Texto em bloco');
  });

  it('na saída o corte de citação é no-op', () => {
    const html = '<p>Veja o depoimento:</p><blockquote>Ótimo serviço</blockquote><p>Até logo</p>';
    expect(resolveLeadMessageBodyText({ ...outbound, bodyHtml: html })).toBe('Veja o depoimento:\n\nÓtimo serviço\nAté logo');
  });
});

describe('stripQuotedHtml e htmlToText', () => {
  it('remove só o bloco citado, com div aninhada, e preserva o resto', () => {
    const html = '<div>Antes</div><div class="gmail_quote"><div><div>dentro</div></div></div><div>Depois</div>';
    expect(htmlToText(stripQuotedHtml(html))).toBe('Antes\nDepois');
  });

  it('remove id gmail_signature', () => {
    expect(htmlToText(stripQuotedHtml('<p>Oi</p><div id="gmail_signature">Assinatura</div>'))).toBe('Oi');
  });
});
