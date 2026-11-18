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

function harness(
  opts: { autoHangup?: boolean; onCarrierHangup?: () => void } = {},
) {
  const socket = fakeSocket();
  const openSocket = vi.fn(() => socket as unknown as WebSocket);
  const startPump = vi.fn();
  let onPcm: (pcm: Int16Array) => void = () => undefined;
  let hooks: AudioPumpHooks = {};
  const stopPump = vi.fn();
  const stop = startLiveAmdBrowser({
    track: {} as MediaStreamTrack,
    callId: '6f1c2a3e-0000-4000-8000-000000000001',
    onView: () => undefined,
    onCarrierHangup: opts.onCarrierHangup,
    fetchImpl: (async () => ({
      json: async () => ({
        enabled: true,
        websocketUrl: 'wss://streaming.assemblyai.com/v3/ws?token=t',
        autoHangup: opts.autoHangup ?? true,
      }),
    })) as unknown as typeof fetch,
    openSocket,
    pump: () => ({
      start(cb, h) {
        startPump();
        onPcm = cb;
        hooks = h ?? {};
        return stopPump;
      },
    }),
  });
  return { socket, stop, stopPump, openSocket, startPump, pcm: (p: Int16Array) => onPcm(p), hooks: () => hooks };
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

describe('desligamento automático por frase de operadora', () => {
  beforeEach(() => {
    record.recordLiveAmd.mockReset();
    record.recordLiveAmd.mockResolvedValue({ success: false, error: 'x' });
    stopActiveLiveAmd();
  });

  const turn = (transcript: string) =>
    JSON.stringify({ type: 'Turn', end_of_turn: true, transcript, words: [{ text: transcript, end: 2_000 }] });

  async function open(onCarrierHangup: () => void) {
    const h = harness({ onCarrierHangup });
    await flush();
    h.socket.readyState = WebSocket.OPEN;
    h.socket.emit('open');
    h.socket.emit('message', JSON.stringify({ type: 'Begin' }));
    return h;
  }

  it('sem a flag (autoHangup ausente) não abre socket nem clona a faixa', async () => {
    const h = harness({ autoHangup: false });
    await flush();
    expect(h.openSocket).not.toHaveBeenCalled();
    expect(h.startPump).not.toHaveBeenCalled();
  });

  it('caixa postal desliga uma vez só', async () => {
    const hangup = vi.fn();
    const h = await open(hangup);
    h.socket.emit('message', turn('Sua chamada está sendo encaminhada para a caixa postal'));
    h.socket.emit('message', turn('grave sua mensagem após o sinal'));
    expect(hangup).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('fora de serviço ou indisponível desliga (era lido como pessoa pelo "olá")', async () => {
    const hangup = vi.fn();
    const h = await open(hangup);
    h.socket.emit('message', turn('Olá, o número que você ligou está fora de serviço ou indisponível'));
    expect(hangup).toHaveBeenCalledTimes(1);
    h.stop();
  });

  it('pessoa atendendo não desliga', async () => {
    const hangup = vi.fn();
    const h = await open(hangup);
    h.socket.emit('message', turn('Alô, quem fala? Pode falar, estou ouvindo'));
    expect(hangup).not.toHaveBeenCalled();
    h.stop();
  });

  describe('marcador de quem desligou', () => {
    const calls = () => record.recordLiveAmd.mock.calls.map((c) => c[0] as Record<string, unknown>);
    const CARRIER = 'Sua chamada está sendo encaminhada para a caixa postal';

    it('grava auto_hangup ANTES de chamar o desligar', async () => {
      const order: string[] = [];
      record.recordLiveAmd.mockImplementation(async (input: Record<string, unknown>) => {
        if (input.autoHangup) order.push('marker');
        return { success: false, error: 'x' };
      });
      const hangup = vi.fn(() => order.push('hangup'));
      const h = await open(hangup);
      h.socket.emit('message', turn(CARRIER));
      expect(order.slice(0, 2)).toEqual(['marker', 'hangup']);
      const marker = calls().find((c) => c.autoHangup)?.autoHangup as Record<string, unknown>;
      expect(Object.keys(marker).sort()).toEqual(['at', 'confidence', 'phrase', 'prediction']);
      expect(marker).toMatchObject({ prediction: 'voicemail' });
      expect(typeof marker.at).toBe('string');
      expect(marker.phrase).toBeTruthy();
      h.stop();
    });

    it('falha ao gravar o marcador não impede o desligar', async () => {
      record.recordLiveAmd.mockImplementation(() => {
        throw new Error('boom');
      });
      const hangup = vi.fn();
      const h = await open(hangup);
      h.socket.emit('message', turn(CARRIER));
      expect(hangup).toHaveBeenCalledTimes(1);
      h.stop();
    });

    it('gravação que rejeita não impede o desligar nem vira erro não tratado', async () => {
      record.recordLiveAmd.mockRejectedValue(new Error('rede'));
      const hangup = vi.fn();
      const h = await open(hangup);
      h.socket.emit('message', turn(CARRIER));
      await flush();
      expect(hangup).toHaveBeenCalledTimes(1);
      h.stop();
    });

    it('sem desligar não há marcador (pessoa atendendo)', async () => {
      const h = await open(vi.fn());
      h.socket.emit('message', turn('Alô, quem fala? Pode falar, estou ouvindo'));
      h.stop();
      expect(calls().some((c) => c.autoHangup)).toBe(false);
    });

    it('o registro do fim da ligação reenvia o marcador (a RPC troca o live_amd inteiro)', async () => {
      const h = await open(vi.fn());
      h.socket.emit('message', turn(CARRIER));
      record.recordLiveAmd.mockClear();
      h.stop();
      const final = calls();
      expect(final.length).toBeGreaterThan(0);
      expect(final.every((c) => c.autoHangup)).toBe(true);
    });
  });
});
