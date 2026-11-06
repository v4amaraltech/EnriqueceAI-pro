import { describe, expect, it } from 'vitest';

import { buildBriefingNotesHtml, resolveSdrDisplayName } from './meeting-briefing-format';

describe('resolveSdrDisplayName', () => {
  it('usa full_name (onde o cadastro guarda o nome)', () => {
    expect(
      resolveSdrDisplayName({ email: 'joao@v4.com', user_metadata: { full_name: 'João Fogaça' } }),
    ).toBe('João Fogaça');
  });

  it('cai para name legado e depois para o e-mail', () => {
    expect(resolveSdrDisplayName({ email: 'a@b.com', user_metadata: { name: 'Ana' } })).toBe('Ana');
    expect(resolveSdrDisplayName({ email: 'a@b.com', user_metadata: { full_name: '  ' } })).toBe('a@b.com');
  });

  it('usa "Pré-vendas" sem usuário', () => {
    expect(resolveSdrDisplayName(null)).toBe('Pré-vendas');
  });
});

describe('buildBriefingNotesHtml', () => {
  it('retorna vazio sem notas', () => {
    expect(buildBriefingNotesHtml(null, [])).toBe('');
    expect(buildBriefingNotesHtml('  ', [{ text: '', created_at: '2026-10-14T13:51:30Z', author: null }])).toBe('');
  });

  it('inclui anotações da aba com data BRT, autor e link clicável', () => {
    const html = buildBriefingNotesHtml(null, [
      {
        text: 'Material da call:\nhttps://docs.google.com/document/d/abc/edit',
        created_at: '2026-10-14T13:51:30Z',
        author: 'joao@v4.com',
      },
    ]);
    expect(html).toContain('14/10, 10:51');
    expect(html).toContain('joao@v4.com');
    expect(html).toContain('<a href="https://docs.google.com/document/d/abc/edit"');
  });

  it('mantém o campo antigo e escapa HTML', () => {
    const html = buildBriefingNotesHtml('<b>antigo</b>', [
      { text: 'nova <script>', created_at: '2026-10-14T13:51:30Z', author: null },
    ]);
    expect(html).toContain('&lt;b&gt;antigo&lt;/b&gt;');
    expect(html).toContain('nova &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
