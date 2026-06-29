import { describe, expect, it } from 'vitest';

import { extractVariables, renderTemplate } from './render-template';

describe('extractVariables', () => {
  it('should extract unique variables from template', () => {
    const template = 'Olá {{nome_fantasia}}, {{razao_social}} fica em {{cidade}}/{{uf}}';
    const vars = extractVariables(template);
    expect(vars).toEqual(['nome_fantasia', 'razao_social', 'cidade', 'uf']);
  });

  it('should return empty array for no variables', () => {
    expect(extractVariables('Sem variáveis')).toEqual([]);
  });

  it('should deduplicate repeated variables', () => {
    const template = '{{nome_fantasia}} - {{nome_fantasia}}';
    const vars = extractVariables(template);
    expect(vars).toEqual(['nome_fantasia']);
  });

  it('should handle template with only variables', () => {
    const template = '{{cnpj}}';
    expect(extractVariables(template)).toEqual(['cnpj']);
  });
});

describe('renderTemplate', () => {
  it('should replace variables with values', () => {
    const template = 'Olá {{nome_fantasia}}, somos da Empresa X';
    const result = renderTemplate(template, { nome_fantasia: 'Acme Corp' });
    expect(result).toBe('Olá Acme Corp, somos da Empresa X');
  });

  it('should replace multiple variables', () => {
    const template = '{{nome_fantasia}} ({{cnpj}}) - {{cidade}}/{{uf}}';
    const result = renderTemplate(template, {
      nome_fantasia: 'Acme',
      cnpj: '12.345.678/0001-00',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    expect(result).toBe('Acme (12.345.678/0001-00) - São Paulo/SP');
  });

  it('should leave unknown variables as-is', () => {
    const template = 'Olá {{nome_fantasia}}, {{unknown_var}}';
    const result = renderTemplate(template, { nome_fantasia: 'Acme' });
    expect(result).toBe('Olá Acme, {{unknown_var}}');
  });

  it('should leave null/undefined variables as-is', () => {
    const template = 'Olá {{nome_fantasia}}';
    const result = renderTemplate(template, { nome_fantasia: null });
    expect(result).toBe('Olá {{nome_fantasia}}');
  });

  it('should handle template with no variables', () => {
    const template = 'Texto sem variáveis';
    const result = renderTemplate(template, {});
    expect(result).toBe('Texto sem variáveis');
  });

  it('should handle empty string values', () => {
    const template = 'Contato: {{email}}';
    const result = renderTemplate(template, { email: '' });
    expect(result).toBe('Contato: ');
  });

  // M2: HTML escaping of interpolated values (lead data is untrusted)
  it('should NOT escape HTML by default (plain-text contexts like subject)', () => {
    const result = renderTemplate('Olá {{nome_fantasia}}', { nome_fantasia: 'A & B <tag>' });
    expect(result).toBe('Olá A & B <tag>');
  });

  it('should escape HTML in variable values when escapeHtml is enabled', () => {
    const result = renderTemplate('<p>Olá {{nome_fantasia}}</p>', { nome_fantasia: 'A & B <script>x</script>' }, { escapeHtml: true });
    expect(result).toBe('<p>Olá A &amp; B &lt;script&gt;x&lt;/script&gt;</p>');
  });

  it('should escape quotes to prevent attribute injection', () => {
    const result = renderTemplate('{{v}}', { v: `"' onmouseover=alert(1)` }, { escapeHtml: true });
    expect(result).toBe('&quot;&#39; onmouseover=alert(1)');
  });

  it('should not escape the template markup itself, only the values', () => {
    const result = renderTemplate('<a href="x">{{v}}</a>', { v: 'Acme' }, { escapeHtml: true });
    expect(result).toBe('<a href="x">Acme</a>');
  });
});
