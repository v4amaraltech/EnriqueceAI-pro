import { describe, expect, it } from 'vitest';

import { buildLeadTemplateVariables, type LeadForVariables } from './build-template-variables';

const baseLead: LeadForVariables = {
  nome_fantasia: 'Concept Artefatos',
  razao_social: 'Concept Artefatos de Cimento LTDA',
  cnpj: '00000000000000',
  email: 'contato@concept.com',
  telefone: null,
  municipio: null,
  uf: null,
  porte: null,
};

describe('buildLeadTemplateVariables', () => {
  it('usa primeiro_nome pré-computado (ex.: first_name do lead) quando presente', () => {
    const vars = buildLeadTemplateVariables({ ...baseLead, primeiro_nome: 'Felipe' });
    expect(vars.primeiro_nome).toBe('Felipe');
  });

  it('aplica title case ao primeiro_nome pré-computado', () => {
    const vars = buildLeadTemplateVariables({ ...baseLead, primeiro_nome: 'FELIPE' });
    expect(vars.primeiro_nome).toBe('Felipe');
  });

  it('cai para o nome do sócio (só primeira palavra) quando não há primeiro_nome', () => {
    const vars = buildLeadTemplateVariables(baseLead, 'João da Silva');
    expect(vars.primeiro_nome).toBe('João');
  });

  it('prioriza primeiro_nome sobre o nome do sócio', () => {
    const vars = buildLeadTemplateVariables({ ...baseLead, primeiro_nome: 'Felipe' }, 'João da Silva');
    expect(vars.primeiro_nome).toBe('Felipe');
  });

  it('regressão: lead com first_name mas SEM sócio ainda resolve o primeiro nome', () => {
    // Espelha o lead "CONCEPT ARTEFATOS" em produção: first_name="Felipe", socios=null.
    // Antes do fix, preview e envio derivavam só do sócio → {{primeiro_nome}} vazio/literal.
    const vars = buildLeadTemplateVariables({ ...baseLead, primeiro_nome: 'Felipe' }, undefined);
    expect(vars.primeiro_nome).toBe('Felipe');
  });

  it('retorna null quando não há nem primeiro_nome nem sócio', () => {
    const vars = buildLeadTemplateVariables(baseLead, null);
    expect(vars.primeiro_nome).toBeNull();
  });
});
