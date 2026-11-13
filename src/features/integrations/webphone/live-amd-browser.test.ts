import { beforeEach, describe, expect, it, vi } from 'vitest';

import { peekActiveLiveAmdStop, stopActiveLiveAmd } from './live-amd-active';
import { startLiveAmdBrowser } from './live-amd-browser';
import type { AudioPumpHooks } from './live-amd-pump';

const record = vi.hoisted(() => ({ recordLiveAmd: vi.fn() }));
vi.mock('@/features/calls/actions/record-live-amd', () => record);

type Listener = (event: { data?: unknown }) => void;

function fakeSocket() {
  const listeners = new Map<string, Listener[]>();
  const socket = {
    readyState: 0,
    binaryType: 'blob',
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: (type: string, fn: Listener) =>
      listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    emit(type: string, data?: unknown) {
      for (const fn of listeners.get(type) ?? []) fn({ data });
    },
  };
  return socket;
}

function harness() {
  const socket = fakeSocket();
  let onPcm: (pcm: Int16Array) => void = () => undefined;
  let hooks: AudioPumpHooks = {};
  const stopPump = vi.fn();
  const stop = startLiveAmdBrowser({
    track: {} as MediaStreamTrack,
    callId: '6f1c2a3e-0000-4000-8000-000000000001',
    onView: () => undefined,
    fetchImpl: (async () => ({
      json: async () => ({
        enabled: true,
        websocketUrl: 'wss://streaming.assemblyai.com/v3/ws?token=t',
      }),
    })) as unknown as typeof fetch,
    openSocket: () => socket as unknown as WebSocket,
    pump: () => ({
      start(cb, h) {
        onPcm = cb;
        hooks = h ?? {};
        return stopPump;
      },
    }),
  });
  return { socket, stop, stopPump, pcm: (p: Int16Array) => onPcm(p), hooks: () => hooks };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const loud = () => new Int16Array(16_000).fill(8_000);

describe('startLiveAmdBrowser', () => {
  beforeEach(() => {
    record.recordLiveAmd.mockReset();
    record.recordLiveAmd.mockResolvedValue({ success: false, error: 'x' });
  });

  it('socket aberto sem Begin não envia áudio; o Begin libera', async () => {
    const h = harness();
    await flush();
    h.socket.readyState = WebSocket.OPEN;
    h.socket.emit('open');
    h.pcm(loud());
    expect(h.socket.send).not.toHaveBeenCalled();
    h.socket.emit('message', JSON.stringify({ type: 'Begin' }));
    expect(h.socket.send).toHaveBeenCalledTimes(1);
    h.pcm(loud());
    expect(h.socket.send).toHaveBeenCalledTimes(2);
  });

  it('contexto suspenso não envia ao socket mesmo depois do Begin', async () => {
    const h = harness();
    await flush();
    h.socket.readyState = WebSocket.OPEN;
    h.socket.emit('open');
    h.hooks().onContextState?.('suspended');
    h.socket.emit('message', JSON.stringify({ type: 'Begin' }));
    h.pcm(loud());
    expect(h.socket.send).not.toHaveBeenCalled();
    h.hooks().onContextState?.('running');
    expect(h.socket.send).toHaveBeenCalledTimes(1);
  });

  it('no fim grava a telemetria com bytes, Begin, pump e motivo do texto vazio', async () => {
    const h = harness();
    await flush();
    h.socket.readyState = WebSocket.OPEN;
    h.socket.emit('open');
    h.hooks().onInfo?.({ pump: 'worklet', trackCloned: true });
    h.hooks().onContextState?.('running');
    h.socket.emit('message', JSON.stringify({ type: 'Begin' }));
    h.pcm(loud());
    h.stop();
    expect(h.stopPump).toHaveBeenCalled();
    expect(h.socket.send).toHaveBeenLastCalledWith(JSON.stringify({ type: 'Terminate' }));
    const last = record.recordLiveAmd.mock.calls.at(-1)?.[0] as {
      telemetry: Record<string, unknown>;
    };
    expect(last.telemetry).toMatchObject({
      bytesSent: 32_000,
      frames: 1,
      beginReceived: true,
      audioContextState: 'running',
      pump: 'worklet',
      trackCloned: true,
      wsError: false,
      emptyReason: 'no_speech',
    });
  });

  it('socket que fecha antes do fim anota ws_error', async () => {
    const h = harness();
    await flush();
    h.socket.emit('error');
    h.socket.emit('close');
    h.pcm(loud());
    h.stop();
    const last = record.recordLiveAmd.mock.calls.at(-1)?.[0] as {
      telemetry: Record<string, unknown>;
    };
    expect(last.telemetry).toMatchObject({ wsError: true, emptyReason: 'ws_error', bytesSent: 0 });
  });
});

describe('stopActiveLiveAmd', () => {
  beforeEach(() => {
    record.recordLiveAmd.mockReset();
    record.recordLiveAmd.mockResolvedValue({ success: false, error: 'x' });
    stopActiveLiveAmd();
  });

  it('para a escuta em curso sem depender do efeito de phase ended', async () => {
    const h = harness();
    await flush();
    expect(peekActiveLiveAmdStop()).not.toBeNull();
    stopActiveLiveAmd();
    expect(h.stopPump).toHaveBeenCalledTimes(1);
    expect(peekActiveLiveAmdStop()).toBeNull();
    // Segunda chamada não quebra e não para de novo.
    stopActiveLiveAmd();
    expect(h.stopPump).toHaveBeenCalledTimes(1);
  });

  it('uma escuta nova para a anterior, para não acumular clones da faixa', async () => {
    const first = harness();
    await flush();
    const second = harness();
    await flush();
    expect(first.stopPump).toHaveBeenCalledTimes(1);
    expect(second.stopPump).not.toHaveBeenCalled();
    stopActiveLiveAmd();
    expect(second.stopPump).toHaveBeenCalledTimes(1);
  });
});
