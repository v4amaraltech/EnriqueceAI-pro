import { describe, expect, it, beforeEach } from 'vitest';

import {
  cancelWebphoneDial,
  claimWebphoneDial,
  publishWebphoneDial,
  reserveWebphoneDial,
  resetWebphoneDialCorrelation,
  sameDialedPhone,
} from './webphone-dial-correlation';

describe('correlação da discagem', () => {
  beforeEach(() => resetWebphoneDialCorrelation());

  it('número com máscara ou DDI é o mesmo destino', () => {
    expect(sameDialedPhone('(11) 5135-0071', '1151350071')).toBe(true);
    expect(sameDialedPhone('551151350071', '1151350071')).toBe(true);
    expect(sameDialedPhone('1151350071', '11954958486')).toBe(false);
  });

  it('o INVITE integrado do mesmo número recebe o token e não pode ser reutilizado', () => {
    const reserved = reserveWebphoneDial('(11) 5135-0071');
    expect(claimWebphoneDial('551151350071', true)).toBe(reserved.token);
    expect(claimWebphoneDial('1151350071', true)).toBeNull();
  });

  it('INVITE de outro número ou não integrado não consome a reserva', () => {
    const reserved = reserveWebphoneDial('1151350071');
    expect(claimWebphoneDial('11954958486', true)).toBeNull();
    expect(claimWebphoneDial('1151350071', false)).toBeNull();
    expect(claimWebphoneDial('1151350071', true)).toBe(reserved.token);
  });

  it('falha do POST cancela a reserva e a resposta antiga não publica por cima da nova', () => {
    const first = reserveWebphoneDial('1151350071');
    cancelWebphoneDial(first.token);
    expect(claimWebphoneDial('1151350071', true)).toBeNull();

    const older = reserveWebphoneDial('1151350071');
    const newer = reserveWebphoneDial('11954958486');
    const published: string[] = [];
    expect(publishWebphoneDial(newer.seq, () => published.push('b'))).toBe(true);
    expect(publishWebphoneDial(older.seq, () => published.push('a'))).toBe(false);
    expect(published).toEqual(['b']);
  });
});
