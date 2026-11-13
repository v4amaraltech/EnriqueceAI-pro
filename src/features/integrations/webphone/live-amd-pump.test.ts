import { afterEach, describe, expect, it, vi } from 'vitest';

import { type CaptureAudioContext, type CaptureEnv, type CaptureTrack, createCapturePump } from './live-amd-pump';
import { resetWebphoneAudioContextsForTests, webphoneAudioContextCount } from './webphone-audio-contexts';

afterEach(() => resetWebphoneAudioContextsForTests());

function node() {
  return { connect: vi.fn(), disconnect: vi.fn() };
}

function fakeTrack(withClone = true) {
  const clone: CaptureTrack = { stop: vi.fn() };
  const original: CaptureTrack = { stop: vi.fn(), ...(withClone ? { clone: vi.fn(() => clone) } : {}) };
  return { original, clone };
}

function fakeEnv(opts: { workletFails?: boolean; state?: string } = {}) {
  const listeners: Array<() => void> = [];
  const processor = { ...node(), onaudioprocess: null as unknown };
  const workletNode = { ...node(), port: { onmessage: null as ((event: { data: unknown }) => void) | null } };
  const ctx = {
    state: opts.state ?? 'running',
    sampleRate: 48_000,
    destination: {},
    audioWorklet: {
      addModule: vi.fn(() => (opts.workletFails ? Promise.reject(new Error('sem worklet')) : Promise.resolve())),
    },
    resume: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
    createMediaStreamSource: vi.fn(() => node()),
    createGain: vi.fn(() => ({ ...node(), gain: { value: 1 } })),
    createScriptProcessor: vi.fn(() => processor),
    addEventListener: vi.fn((_type: string, fn: () => void) => listeners.push(fn)),
    removeEventListener: vi.fn(),
  };
  const streams: unknown[] = [];
  const env: CaptureEnv = {
    createContext: () => ctx as unknown as CaptureAudioContext,
    createStream: (track) => {
      streams.push(track);
      return { track };
    },
    createWorkletNode: vi.fn(() => workletNode),
    workletUrl: '/worklets/live-amd-capture.js',
  };
  return { env, ctx, processor, workletNode, streams, listeners };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('captura da escuta', () => {
  it('liga o contexto num clone da faixa e no fim para só o clone', async () => {
    const { original, clone } = fakeTrack();
    const { env, ctx, streams, workletNode } = fakeEnv();
    const onInfo = vi.fn();
    const pcm: Int16Array[] = [];
    const stop = createCapturePump(original, env).start((chunk) => pcm.push(chunk), { onInfo });
    await flush();
    expect(streams).toEqual([clone]);
    expect(onInfo).toHaveBeenCalledWith({ pump: 'worklet', trackCloned: true });
    expect(webphoneAudioContextCount()).toBe(1);

    workletNode.port.onmessage?.({ data: new Float32Array(4_800).fill(0.5) });
    expect(pcm[0]?.length).toBe(1_600);

    stop();
    expect(clone.stop).toHaveBeenCalledTimes(1);
    expect(original.stop).not.toHaveBeenCalled();
    expect(ctx.close).toHaveBeenCalled();
    expect(webphoneAudioContextCount()).toBe(0);
  });

  it('sem clone() usa a faixa original, anota e não a para', async () => {
    const { original } = fakeTrack(false);
    const { env, streams } = fakeEnv();
    const onInfo = vi.fn();
    const stop = createCapturePump(original, env).start(() => undefined, { onInfo });
    await flush();
    expect(streams).toEqual([original]);
    expect(onInfo).toHaveBeenCalledWith({ pump: 'worklet', trackCloned: false });
    stop();
    expect(original.stop).not.toHaveBeenCalled();
  });

  it('worklet que não carrega cai no ScriptProcessor', async () => {
    const { original } = fakeTrack();
    const { env, ctx, processor } = fakeEnv({ workletFails: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const onInfo = vi.fn();
    const pcm: Int16Array[] = [];
    createCapturePump(original, env).start((chunk) => pcm.push(chunk), { onInfo });
    await flush();
    expect(ctx.createScriptProcessor).toHaveBeenCalledWith(4096, 1, 1);
    expect(onInfo).toHaveBeenCalledWith({ pump: 'script_processor', trackCloned: true });
    const handler = (processor as unknown as { onaudioprocess: (e: unknown) => void }).onaudioprocess;
    handler({ inputBuffer: { sampleRate: 32_000, getChannelData: () => new Float32Array([0.5, 0.5]) } });
    expect(pcm[0]?.length).toBe(1);
    warn.mockRestore();
  });

  it('informa o estado do contexto e as mudanças', async () => {
    const { original } = fakeTrack();
    const { env, ctx, listeners } = fakeEnv({ state: 'suspended' });
    const onContextState = vi.fn();
    createCapturePump(original, env).start(() => undefined, { onContextState });
    expect(onContextState).toHaveBeenLastCalledWith('suspended');
    expect(ctx.resume).toHaveBeenCalled();
    ctx.state = 'running';
    listeners.forEach((fn) => fn());
    expect(onContextState).toHaveBeenLastCalledWith('running');
  });

  it('sem AudioContext não captura e informa pump none', () => {
    const onInfo = vi.fn();
    createCapturePump(fakeTrack().original, null).start(() => undefined, { onInfo });
    expect(onInfo).toHaveBeenCalledWith({ pump: 'none', trackCloned: null });
  });
});
