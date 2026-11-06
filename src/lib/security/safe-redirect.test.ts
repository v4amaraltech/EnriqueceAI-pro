import { describe, expect, it } from 'vitest';

import { sanitizeRedirect } from './safe-redirect';

const APP = 'https://app.enriqueceai.com.br';

describe('sanitizeRedirect', () => {
  it('mantém os destinos usados hoje', () => {
    expect(sanitizeRedirect('/onboarding?step=3&gmail=connected', APP)).toBe('/onboarding?step=3&gmail=connected');
    expect(sanitizeRedirect('/settings/company/email', APP)).toBe('/settings/company/email');
  });

  it('mantém caminho relativo do próprio app, com query', () => {
    expect(sanitizeRedirect('/atividades?tab=email', APP)).toBe('/atividades?tab=email');
  });

  it.each([
    ['vazio', null],
    ['sem barra inicial', 'evil.com'],
    ['protocol-relative', '//evil.com'],
    ['barra invertida (vira //evil.com no navegador)', '/\\evil.com'],
    ['barra invertida escondida', '/foo/..\\..\\evil.com'],
    ['esquema embutido', '/redirect?to=https://evil.com'],
    ['ponto + barra dupla (vira //evil.com ao normalizar)', '/.//evil.com'],
    ['ponto-ponto + barra dupla', '/..//evil.com'],
  ])('recusa %s', (_label, input) => {
    expect(sanitizeRedirect(input, APP)).toBe('/settings/integrations');
  });

  it('o resultado nunca sai do domínio do app', () => {
    for (const input of ['/\t/evil.com', '/\n/evil.com', '/%5Cevil.com', '/./evil', '/a/../b', '/.//evil.com', '/a/..//evil.com']) {
      const out = sanitizeRedirect(input, APP);
      // A rota re-resolve o caminho contra o app (new URL(out, appUrl)) — tem de continuar no app.
      expect(new URL(`${out}?error=x`, APP).origin).toBe(APP);
    }
  });
});
