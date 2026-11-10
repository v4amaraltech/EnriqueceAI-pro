import { describe, expect, it } from 'vitest';

import { messageBody, plainToHtml, sanitizeChatHtml } from './body';

const SENT = [
  '<p>Olá Sandro, tudo bem?</p>',
  '<p>Cheguei até você pesquisando indústrias.</p>',
  '<p>Att,<br><strong>Vinicius Mercante</strong><br>Gerente de Receita<br>',
  '<a href="https://v4company.com" onclick="alert(1)">https://v4company.com</a></p>',
  '<ul><li>Um</li><li>Dois</li></ul>',
  '<script>alert(1)</script>',
  '<style>p{color:red}</style>',
  '<img src="https://evil.test/pixel.png" onerror="alert(1)" alt="foto">',
  '<a href="javascript:alert(1)">clique</a>',
].join('');

describe('corpo da conversa', () => {
  it('mantém parágrafos, quebra, negrito e lista, e tira o que é perigoso', () => {
    const clean = sanitizeChatHtml(SENT);
    expect(clean).toContain('<p>Olá Sandro, tudo bem?</p>');
    expect(clean).toContain('<br>');
    expect(clean).toContain('<strong>Vinicius Mercante</strong>');
    expect(clean).toContain('<li>Um</li>');
    expect(clean).toContain('target="_blank"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).not.toMatch(/script|style|onerror|onclick|javascript:|<img|evil\.test/i);
  });

  it('preserva linhas em branco do texto puro e cria links', () => {
    const html = plainToHtml('Oi Lucas\n\nTudo bem?\nVeja https://v4company.com.\nEscreva para ana@v4company.com');
    const clean = sanitizeChatHtml(html);
    expect(clean.match(/<p>/g)).toHaveLength(2);
    expect(clean).toContain('<br>');
    expect(clean).toContain('href="https://v4company.com"');
    expect(clean).toContain('href="mailto:ana@v4company.com"');
    expect(clean).toContain('target="_blank"');
    expect(clean).not.toContain('<script');
  });

  it('prefere o HTML gravado e não achata o texto puro com quebra', () => {
    const fromHtml = messageBody({
      html: '<p>Primeiro parágrafo</p><p>Segundo</p>',
      text: 'Primeiro parágrafo Segundo',
    });
    expect(fromHtml.html).toContain('<p>Segundo</p>');
    expect(fromHtml.text).toBe('Primeiro parágrafo Segundo');

    const plain = messageBody({ text: 'Linha 1\n\nLinha 2' });
    expect(plain.text).toBe('Linha 1\n\nLinha 2');
    expect(plain.html).toContain('<p>Linha 1</p><p>Linha 2</p>');

    const single = messageBody({ text: 'Oi' });
    expect(single).toEqual({ text: 'Oi', html: null });
  });
});
