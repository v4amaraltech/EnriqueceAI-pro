import { describe, expect, it } from 'vitest';

import { phoneSearchDigits, searchClausesForTerm, splitSearchTerms } from './lead-search';

const TEXT_CLAUSES = (t: string) =>
  `razao_social.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj.ilike.%${t}%,first_name.ilike.%${t}%,last_name.ilike.%${t}%,email.ilike.%${t}%`;

describe('phoneSearchDigits', () => {
  it('ignora termos com menos de 6 dígitos', () => {
    expect(phoneSearchDigits('Acme')).toBeNull();
    expect(phoneSearchDigits('2024')).toBeNull();
    expect(phoneSearchDigits('(16)')).toBeNull();
  });

  it('mantém só os dígitos', () => {
    expect(phoneSearchDigits('99986-7577')).toBe('999867577');
    expect(phoneSearchDigits('(16) 99986-7577')).toBe('16999867577');
  });

  it('descarta o DDI 55 na frente de um número completo', () => {
    expect(phoneSearchDigits('+55 16 99986-7577')).toBe('16999867577');
    expect(phoneSearchDigits('5516999867577')).toBe('16999867577');
    expect(phoneSearchDigits('551699867577')).toBe('1699867577');
  });

  it('não mexe num número que só começa com 55 (DDD 55)', () => {
    expect(phoneSearchDigits('55999867577')).toBe('55999867577');
  });
});

describe('splitSearchTerms', () => {
  it('separa texto por espaço', () => {
    expect(splitSearchTerms('  Saude da  Mente ')).toEqual(['Saude', 'da', 'Mente']);
  });

  it('remove curingas SQL', () => {
    expect(splitSearchTerms('test%_hack')).toEqual(['testhack']);
  });

  it('trata um telefone formatado como um termo só, em dígitos', () => {
    expect(splitSearchTerms('+55 (16) 99986-7577')).toEqual(['5516999867577']);
    expect(splitSearchTerms('16 99986 7577')).toEqual(['16999867577']);
  });

  it('não junta termos quando há letras', () => {
    expect(splitSearchTerms('Loja 16 99986')).toEqual(['Loja', '16', '99986']);
  });

  it('busca vazia vira lista vazia', () => {
    expect(splitSearchTerms('   ')).toEqual([]);
  });
});

describe('searchClausesForTerm', () => {
  it('texto comum: só os campos de texto', () => {
    expect(searchClausesForTerm('Company').join(',')).toBe(TEXT_CLAUSES('Company'));
  });

  it('CNPJ formatado: acrescenta os dígitos no cnpj e no telefone', () => {
    expect(searchClausesForTerm('08.942.835/0001-72')).toEqual([
      ...TEXT_CLAUSES('08.942.835/0001-72').split(','),
      'cnpj.ilike.%08942835000172%',
      'phone_digits.ilike.%08942835000172%',
    ]);
  });

  it('telefone em dígitos: acrescenta a cláusula phone_digits sem o DDI', () => {
    expect(searchClausesForTerm('5516999867577')).toEqual([
      ...TEXT_CLAUSES('5516999867577').split(','),
      'phone_digits.ilike.%16999867577%',
    ]);
  });

  it('remove metacaracteres do PostgREST antes de montar a cláusula', () => {
    expect(searchClausesForTerm('x,status.eq.won').join(',')).toBe(TEXT_CLAUSES('xstatus.eq.won'));
  });
});
