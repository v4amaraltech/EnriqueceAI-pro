import { describe, expect, it } from 'vitest';

import { entraNaFilaHumana } from './fila-humana';

describe('entraNaFilaHumana', () => {
  it('cadência normal do SDR entra', () => {
    expect(entraNaFilaHumana({ type: 'standard', executor: 'sdr' })).toBe(true);
  });

  it('cadência executada pela IA não entra', () => {
    expect(entraNaFilaHumana({ type: 'standard', executor: 'bdr_ai' })).toBe(false);
  });

  it('e-mail automático não entra, seja de quem for', () => {
    expect(entraNaFilaHumana({ type: 'auto_email', executor: 'sdr' })).toBe(false);
    expect(entraNaFilaHumana({ type: 'auto_email', executor: 'bdr_ai' })).toBe(false);
  });

  it('sem executor informado continua entrando (comportamento antigo)', () => {
    expect(entraNaFilaHumana({ type: 'standard' })).toBe(true);
  });
});
