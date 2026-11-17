import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Mod = typeof import('./webphone-keypad-sound');

function makeCtx() {
  const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(), start: vi.fn(), stop: vi.fn() };
  const gain = { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn() };
  return {
    osc,
    gain,
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(() => Promise.resolve()),
    createOscillator: vi.fn(() => osc),
    createGain: vi.fn(() => gain),
  };
}

describe('webphone-keypad-sound', () => {
  let mod: Mod;
  let ctor: ReturnType<typeof vi.fn>;
  let ctx: ReturnType<typeof makeCtx>;

  beforeEach(async () => {
    vi.resetModules();
    ctx = makeCtx();
    ctor = vi.fn(function () {
      return ctx;
    });
    vi.stubGlobal('AudioContext', ctor);
    window.localStorage.clear();
    mod = await import('./webphone-keypad-sound');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('cria o AudioContext só no primeiro bip e reaproveita', () => {
    expect(ctor).not.toHaveBeenCalled();
    mod.playKeypadBeep('ok');
    mod.playKeypadBeep('ok');
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(ctx.createOscillator).toHaveBeenCalledTimes(2);
  });

  it('bip de sucesso é curto e agudo; de falha é grave e mais longo', () => {
    mod.playKeypadBeep('ok');
    const okFreq = ctx.osc.frequency.value;
    const okStop = ctx.osc.stop.mock.calls[0]?.[0] as number;
    mod.playKeypadBeep('fail');
    expect(ctx.osc.frequency.value).toBeLessThan(okFreq);
    expect(ctx.osc.stop.mock.calls[1]?.[0] as number).toBeGreaterThan(okStop);
    expect(okStop).toBeLessThan(0.07);
  });

  it('sem AudioContext (ou que lança) não quebra', () => {
    vi.stubGlobal('AudioContext', undefined);
    expect(() => mod.playKeypadBeep('ok')).not.toThrow();
  });

  it('construtor que lança não quebra', async () => {
    vi.resetModules();
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function () {
        throw new Error('bloqueado');
      }),
    );
    const m = await import('./webphone-keypad-sound');
    expect(() => m.playKeypadBeep('fail')).not.toThrow();
  });

  it('lê e grava a preferência no localStorage (padrão ligado)', () => {
    expect(mod.readKeypadSound()).toBe(true);
    mod.writeKeypadSound(false);
    expect(window.localStorage.getItem('enriqueceai.webphone.keypad-sound')).toBe('0');
    expect(mod.readKeypadSound()).toBe(false);
    mod.writeKeypadSound(true);
    expect(mod.readKeypadSound()).toBe(true);
  });

  it('localStorage que lança não quebra', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('x');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('x');
    });
    expect(mod.readKeypadSound()).toBe(true);
    expect(() => mod.writeKeypadSound(false)).not.toThrow();
  });
});
