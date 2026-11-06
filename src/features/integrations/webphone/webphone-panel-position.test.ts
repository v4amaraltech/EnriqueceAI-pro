import { describe, expect, it, vi } from 'vitest';

import {
  WEBPHONE_PANEL_POSITION_KEY,
  clampPanelPosition,
  loadPanelPosition,
  movePanelPosition,
  parsePanelPosition,
  savePanelPosition,
} from './webphone-panel-position';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

const size = { width: 320, height: 200 };
const viewport = { width: 1280, height: 800 };

describe('parsePanelPosition', () => {
  it('aceita só objetos com x e y numéricos finitos', () => {
    expect(parsePanelPosition('{"x":10.4,"y":20.6}')).toEqual({ x: 10, y: 21 });
    expect(parsePanelPosition(null)).toBeNull();
    expect(parsePanelPosition('')).toBeNull();
    expect(parsePanelPosition('não é json')).toBeNull();
    expect(parsePanelPosition('[1,2]')).toBeNull();
    expect(parsePanelPosition('{"x":"10","y":20}')).toBeNull();
    expect(parsePanelPosition('{"x":1e999,"y":20}')).toBeNull();
  });
});

describe('loadPanelPosition / savePanelPosition', () => {
  it('grava e lê de volta pela chave versionada', () => {
    const storage = memoryStorage();
    savePanelPosition(storage, { x: 40, y: 60 });
    expect(storage.data.get(WEBPHONE_PANEL_POSITION_KEY)).toBe('{"x":40,"y":60}');
    expect(loadPanelPosition(storage)).toEqual({ x: 40, y: 60 });
  });

  it('null apaga a posição lembrada', () => {
    const storage = memoryStorage({ [WEBPHONE_PANEL_POSITION_KEY]: '{"x":1,"y":2}' });
    savePanelPosition(storage, null);
    expect(loadPanelPosition(storage)).toBeNull();
  });

  it('storage ausente ou que lança (modo privado, cota) não quebra', () => {
    expect(loadPanelPosition(null)).toBeNull();
    expect(loadPanelPosition(undefined)).toBeNull();
    const broken = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      }),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: vi.fn(),
    };
    expect(loadPanelPosition(broken)).toBeNull();
    expect(() => savePanelPosition(broken, { x: 1, y: 1 })).not.toThrow();
    expect(() => savePanelPosition(null, { x: 1, y: 1 })).not.toThrow();
  });
});

describe('clampPanelPosition / movePanelPosition', () => {
  it('mantém o painel dentro da viewport com a margem', () => {
    expect(clampPanelPosition({ x: -50, y: -50 }, size, viewport)).toEqual({ x: 8, y: 8 });
    expect(clampPanelPosition({ x: 5000, y: 5000 }, size, viewport)).toEqual({ x: 1280 - 320 - 8, y: 800 - 200 - 8 });
    expect(clampPanelPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 });
  });

  it('viewport menor que o painel encosta no canto superior esquerdo', () => {
    expect(clampPanelPosition({ x: 300, y: 300 }, size, { width: 200, height: 100 })).toEqual({ x: 8, y: 8 });
  });

  it('movePanelPosition soma o deslocamento do arrasto e limita', () => {
    expect(movePanelPosition({ x: 100, y: 100 }, { x: 30, y: -20 }, size, viewport)).toEqual({ x: 130, y: 80 });
    expect(movePanelPosition({ x: 900, y: 100 }, { x: 500, y: 0 }, size, viewport)).toEqual({ x: 952, y: 100 });
  });
});
