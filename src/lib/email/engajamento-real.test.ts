import { describe, expect, it } from 'vitest';

import { ENGAJAMENTO_REAL_MIN_SEG, marcaEngajamentoReal, segundosAposEnvio } from './engajamento-real';

const ENVIO = '2026-10-16T12:00:00.000Z';
const depois = (seg: number) => new Date(Date.parse(ENVIO) + seg * 1000);

describe('segundosAposEnvio', () => {
  it('conta os segundos desde o envio', () => {
    expect(segundosAposEnvio(ENVIO, depois(90))).toBe(90);
  });

  it('devolve null sem data ou com data inválida', () => {
    expect(segundosAposEnvio(null, depois(90))).toBeNull();
    expect(segundosAposEnvio('lixo', depois(90))).toBeNull();
  });
});

describe('marcaEngajamentoReal', () => {
  it('ignora abertura de robô logo após o envio', () => {
    expect(marcaEngajamentoReal({}, 'aberto_real_em', ENVIO, depois(15))).toBeNull();
    expect(marcaEngajamentoReal({}, 'aberto_real_em', ENVIO, depois(ENGAJAMENTO_REAL_MIN_SEG - 1))).toBeNull();
  });

  it('marca a primeira abertura depois do corte', () => {
    const agora = depois(ENGAJAMENTO_REAL_MIN_SEG);
    expect(marcaEngajamentoReal({ open_count: 1 }, 'aberto_real_em', ENVIO, agora)).toEqual({ aberto_real_em: agora.toISOString() });
  });

  it('não sobrescreve a data já marcada', () => {
    expect(marcaEngajamentoReal({ aberto_real_em: '2026-10-16T13:00:00.000Z' }, 'aberto_real_em', ENVIO, depois(7200))).toBeNull();
  });

  it('marca clique em campo próprio', () => {
    const agora = depois(600);
    expect(marcaEngajamentoReal({ aberto_real_em: 'x' }, 'clicado_real_em', ENVIO, agora)).toEqual({ clicado_real_em: agora.toISOString() });
  });

  it('não marca sem data de envio', () => {
    expect(marcaEngajamentoReal({}, 'aberto_real_em', undefined, depois(600))).toBeNull();
  });
});
