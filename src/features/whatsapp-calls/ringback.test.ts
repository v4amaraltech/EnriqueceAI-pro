import { afterEach, describe, expect, it, vi } from 'vitest';

import { startRingback } from './ringback';

/** Mock mínimo de Web Audio suficiente para observar o agendamento do tom. */
function installAudioMock() {
  const started: number[] = [];
  const stopped: number[] = [];
  let closed = false;

  class FakeParam {
    setValueAtTime = vi.fn();
    linearRampToValueAtTime = vi.fn();
    value = 0;
  }
  class FakeOsc {
    type = '';
    frequency = new FakeParam();
    onended: (() => void) | null = null;
    connect = vi.fn(() => ({ connect: vi.fn() }));
    disconnect = vi.fn();
    start = vi.fn((at: number) => started.push(at));
    stop = vi.fn((at?: number) => stopped.push(at ?? -1));
  }
  class FakeGain {
    gain = new FakeParam();
    connect = vi.fn();
    disconnect = vi.fn();
  }
  class FakeCtx {
    currentTime = 0;
    destination = {};
    createOscillator = vi.fn(() => new FakeOsc());
    createGain = vi.fn(() => new FakeGain());
    close = vi.fn(() => {
      closed = true;
      return Promise.resolve();
    });
  }

  vi.stubGlobal('AudioContext', FakeCtx as unknown as typeof AudioContext);
  return { started, stopped, isClosed: () => closed };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('startRingback', () => {
  it('não lança quando a Web Audio API não existe (jsdom sem AudioContext)', () => {
    // Degradação silenciosa: ficar sem tom é aceitável, quebrar a ligação não.
    expect(() => {
      const rb = startRingback();
      rb.stop();
    }).not.toThrow();
  });

  it('toca o primeiro tom imediatamente ao iniciar', () => {
    const audio = installAudioMock();
    const rb = startRingback();
    expect(audio.started).toHaveLength(1);
    rb.stop();
  });

  it('repete o tom a cada ciclo de 5s (1s tom + 4s silêncio)', () => {
    vi.useFakeTimers();
    const audio = installAudioMock();
    const rb = startRingback();

    expect(audio.started).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(audio.started).toHaveLength(2);
    vi.advanceTimersByTime(10_000);
    expect(audio.started).toHaveLength(4);

    rb.stop();
  });

  it('para de repetir e fecha o contexto no stop()', () => {
    vi.useFakeTimers();
    const audio = installAudioMock();
    const rb = startRingback();
    rb.stop();

    const afterStop = audio.started.length;
    vi.advanceTimersByTime(20_000);
    expect(audio.started).toHaveLength(afterStop); // nenhum tom novo
    expect(audio.isClosed()).toBe(true);
  });

  it('stop() é idempotente — chamar duas vezes não lança', () => {
    installAudioMock();
    const rb = startRingback();
    expect(() => {
      rb.stop();
      rb.stop();
    }).not.toThrow();
  });
});
