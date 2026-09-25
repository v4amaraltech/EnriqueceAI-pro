import { describe, expect, it } from 'vitest';

import { decidirCelular, diasUteisEntre, e164BR, ehCelularBR, ehFixoBR, ordenarCelularPrimeiro, proximoDiaUtil9hSP, telefonePrincipal } from './celular';

describe('celular / fixo BR', () => {
  it('reconhece formatos comuns', () => {
    expect(ehCelularBR('+55 85 99276-0356')).toBe(true);
    expect(ehCelularBR('85992760356')).toBe(true);
    expect(ehCelularBR('+55 11 3038-1800')).toBe(false);
    expect(ehFixoBR('+55 11 3038-1800')).toBe(true);
    expect(ehCelularBR('+90 533 412 8797')).toBe(false);
    expect(e164BR('+90 533 412 8797')).toBeNull();
    expect(e164BR('(46) 3533-8100')).toBe('+554635338100');
  });
});

describe('ordenarCelularPrimeiro / telefonePrincipal (item 1)', () => {
  it('caso real AB Mauri: fixo da sede na frente, celular chega depois → celular vira o 1º', () => {
    const r = ordenarCelularPrimeiro([{ tipo: 'fixo', numero: '+55 11 3038-1800' }, { tipo: 'fixo', numero: '+55 12 99793-5865' }]);
    expect(r.map((p) => p.numero)).toEqual(['+55 12 99793-5865', '+55 11 3038-1800']);
    expect(r[0]!.tipo).toBe('celular');
  });
  it('sem celular mantém a ordem e remove vazios', () => {
    expect(ordenarCelularPrimeiro([{ numero: '' }, { tipo: 'fixo', numero: '1130381800' }]).map((p) => p.numero)).toEqual(['1130381800']);
  });
  it('principal: troca fixo por celular; mantém celular atual; sem nada → null', () => {
    expect(telefonePrincipal('+55 11 3038-1800', [{ numero: '+55 12 99793-5865' }])).toBe('+55 12 99793-5865');
    expect(telefonePrincipal('+55 11 98888-7777', [{ numero: '+55 12 99793-5865' }])).toBe('+55 11 98888-7777');
    expect(telefonePrincipal(null, [])).toBeNull();
    expect(telefonePrincipal(null, [{ numero: '+55 11 3038-1800' }])).toBe('+55 11 3038-1800');
  });
});

describe('dias úteis (fuso SP)', () => {
  const qua = new Date('2026-09-23T20:00:00Z'); // qua 17h SP
  it('conta só seg-sex', () => {
    expect(diasUteisEntre(qua, new Date('2026-09-24T15:00:00Z'))).toBe(1); // qui
    expect(diasUteisEntre(qua, new Date('2026-09-28T15:00:00Z'))).toBe(3); // seg (qui, sex, seg)
    expect(diasUteisEntre(qua, qua)).toBe(0);
  });
  it('próximo dia útil às 9h SP pula o fim de semana', () => {
    expect(proximoDiaUtil9hSP(new Date('2026-09-25T20:00:00Z')).toISOString()).toBe('2026-09-28T12:00:00.000Z'); // sex → seg 9h
    expect(proximoDiaUtil9hSP(qua).toISOString()).toBe('2026-09-24T12:00:00.000Z');
    expect(proximoDiaUtil9hSP(new Date('2026-09-24T02:30:00Z')).toISOString()).toBe('2026-09-24T12:00:00.000Z'); // 23h30 SP de qua → qui 9h
  });
});

describe('decidirCelular (item 2)', () => {
  const agora = new Date('2026-09-24T20:00:00Z');
  it('tem celular em qualquer lista → liga nele', () => {
    const d = decidirCelular({ numeros: ['+55 11 3038-1800', '+55 12 99793-5865'], esperas: [], agora });
    expect(d).toMatchObject({ acao: 'ligar', telefone: '+5512997935865', pedirRevelacao: false });
  });
  it('sem telefone e sem pedido anterior → aguarda e pede revelação', () => {
    expect(decidirCelular({ numeros: [null, ''], esperas: [], agora })).toMatchObject({ acao: 'aguardar', pedirRevelacao: true });
  });
  it('pedido feito há 2 h → aguarda sem pedir de novo', () => {
    const d = decidirCelular({ numeros: [], esperas: [new Date(agora.getTime() - 2 * 3_600_000)], agora });
    expect(d).toMatchObject({ acao: 'aguardar', pedirRevelacao: false });
  });
  it('pedido de ontem → pede de novo (Apollo pode ter recebido crédito)', () => {
    const d = decidirCelular({ numeros: [], esperas: [new Date(agora.getTime() - 24 * 3_600_000)], agora });
    expect(d).toMatchObject({ acao: 'aguardar', pedirRevelacao: true });
  });
  it('3 dias úteis sem celular e sem telefone → encerra', () => {
    const d = decidirCelular({ numeros: [], esperas: [new Date('2026-09-18T20:00:00Z')], agora });
    expect(d.acao).toBe('encerrar');
  });
  it('3 dias úteis sem celular mas com fixo → liga no fixo', () => {
    const d = decidirCelular({ numeros: ['+55 46 3533-8100'], esperas: [new Date('2026-09-18T20:00:00Z')], agora });
    expect(d).toMatchObject({ acao: 'ligar_fixo', telefone: '+554635338100' });
  });
  it('número estrangeiro não conta como telefone BR', () => {
    expect(decidirCelular({ numeros: ['+90 533 412 8797'], esperas: [], agora }).acao).toBe('aguardar');
  });
});
