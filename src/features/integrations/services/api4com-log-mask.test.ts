import { describe, expect, it } from 'vitest';

import { maskCalledForLog } from './api4com-log-mask';

describe('maskCalledForLog', () => {
  it('número completo vira só o sufixo de 4 dígitos', () => {
    expect(maskCalledForLog('+5548988669122')).toBe('****9122');
    expect(maskCalledForLog('5548988669122')).toBe('****9122');
    expect(maskCalledForLog('(48) 98866-9122')).toBe('****9122');
  });

  it('nunca contém o número em claro', () => {
    const masked = maskCalledForLog('+5548988669122');
    expect(masked).not.toContain('5548988669122');
    expect(masked).not.toContain('98866');
  });

  it('vazio, nulo ou sem dígitos não quebra', () => {
    expect(maskCalledForLog('')).toBe('(vazio)');
    expect(maskCalledForLog(null)).toBe('(vazio)');
    expect(maskCalledForLog(undefined)).toBe('(vazio)');
    expect(maskCalledForLog('anonymous')).toBe('(vazio)');
  });

  it('valor curto não vaza nenhum dígito', () => {
    expect(maskCalledForLog('1234')).toBe('****');
    expect(maskCalledForLog('12345678')).toBe('****');
    expect(maskCalledForLog('12')).toBe('****');
  });
});
