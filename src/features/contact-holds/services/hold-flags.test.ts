import { describe, expect, it } from 'vitest';

import { isQueryablePhone, phoneDigits, resolveHoldFlags } from './hold-flags';

describe('resolveHoldFlags', () => {
  it('sem holds: tudo liberado, sempre booleanos', () => {
    expect(resolveHoldFlags([])).toEqual({ bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: false });
  });

  it('prospeccao bloqueia só a cadência fria (ligação + e-mail automático); a conversa segue', () => {
    expect(resolveHoldFlags([{ lead_id: 'a', tipo: 'prospeccao' }])).toEqual({
      bloqueado_total: false, bloqueado_prospeccao: true, bloqueado_conversa: false,
    });
  });

  it('conversa bloqueia a IA conversacional, não marca total', () => {
    expect(resolveHoldFlags([{ lead_id: 'a', tipo: 'conversa' }])).toEqual({
      bloqueado_total: false, bloqueado_prospeccao: false, bloqueado_conversa: true,
    });
  });

  it('total implica prospeccao e conversa', () => {
    expect(resolveHoldFlags([{ lead_id: 'a', tipo: 'total' }])).toEqual({
      bloqueado_total: true, bloqueado_prospeccao: true, bloqueado_conversa: true,
    });
  });

  it('vários leads no mesmo telefone: basta um com recusa para bloquear', () => {
    const r = resolveHoldFlags([
      { lead_id: 'a', tipo: 'prospeccao' },
      { lead_id: 'b', tipo: 'total' },
    ]);
    expect(r.bloqueado_total).toBe(true);
  });

  it('tipo desconhecido é ignorado (não bloqueia nem quebra)', () => {
    expect(resolveHoldFlags([{ lead_id: 'a', tipo: 'xyz' }]).bloqueado_total).toBe(false);
  });
});

describe('phoneDigits / isQueryablePhone', () => {
  it('normaliza formatos comuns', () => {
    expect(phoneDigits('+55 (16) 99986-7577')).toBe('5516999867577');
    expect(phoneDigits('16999867577')).toBe('16999867577');
    expect(phoneDigits(null)).toBe('');
  });
  it('recusa telefone curto ou absurdo', () => {
    expect(isQueryablePhone('999867577')).toBe(false);
    expect(isQueryablePhone('16999867577')).toBe(true);
    expect(isQueryablePhone('5516999867577')).toBe(true);
    expect(isQueryablePhone('123456789012345')).toBe(false);
  });
});
