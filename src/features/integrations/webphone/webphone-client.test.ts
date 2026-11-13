import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- JsSIP falso: guarda a config do UA e os handlers para disparar eventos ---
const sip = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void;
  const instances: Array<{
    config: Record<string, unknown>;
    handlers: Map<string, Handler[]>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    register: ReturnType<typeof vi.fn>;
    emit: (event: string, payload?: unknown) => void;
  }> = [];
  return { instances };
});

vi.mock('jssip', () => {
  class WebSocketInterface {
    constructor(public url: string) {}
  }
  class UA {
    config: Record<string, unknown>;
    handlers = new Map<string, Array<(payload?: unknown) => void>>();
    start = vi.fn();
    stop = vi.fn();
    register = vi.fn();
    constructor(config: Record<string, unknown>) {
      this.config = config;
      sip.instances.push(this);
    }
    on(event: string, handler: (payload?: unknown) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    }
    emit(event: string, payload?: unknown) {
      for (const h of this.handlers.get(event) ?? []) h(payload);
    }
  }
  return { WebSocketInterface, UA, default: { WebSocketInterface, UA } };
});

type Client = typeof import('./webphone-client');

const CONFIG = { sipDomain: 'sip.example.test', ramal: '1001', sipPassword: 'segredo-de-teste' };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

let getUserMedia: ReturnType<typeof vi.fn>;
let permissionQuery: ReturnType<typeof vi.fn>;
let client: Client;

/** Estado de `navigator.permissions.query({ name: 'microphone' })`; null = sem a API. */
function setMicPermission(state: 'granted' | 'prompt' | 'denied' | 'throws' | null): void {
  if (state === null) {
    Object.defineProperty(navigator, 'permissions', { configurable: true, value: undefined });
    return;
  }
  permissionQuery = vi.fn(() =>
    state === 'throws' ? Promise.reject(new TypeError('microphone desconhecido')) : Promise.resolve({ state }),
  );
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: permissionQuery } });
}

/** Deixa as Promises pendentes do start (consulta da permissão, getUserMedia) resolverem. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function fakeAudioContext(state = 'suspended') {
  return { state, resume: vi.fn(() => Promise.resolve()) };
}

async function loadClient(): Promise<Client> {
  vi.resetModules();
  return import('./webphone-client');
}

function lastUa() {
  const ua = sip.instances.at(-1);
  if (!ua) throw new Error('UA não criado');
  return ua;
}

function fakeSession(integrated: boolean) {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const session = {
    direction: 'incoming',
    remote_identity: { uri: { user: '5511999990000' } },
    on: vi.fn((event: string, h: (payload?: unknown) => void) => handlers.set(event, h)),
    answer: vi.fn(),
    terminate: vi.fn(),
  };
  const request = { getHeader: () => (integrated ? 'true' : null) };
  return { session, request };
}

beforeEach(async () => {
  sip.instances.length = 0;
  window.localStorage.clear();
  vi.stubGlobal('BroadcastChannel', undefined);
  const track = { stop: vi.fn() };
  getUserMedia = vi.fn(() => Promise.resolve({ getTracks: () => [track] }));
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  setMicPermission('prompt');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  client = await loadClient();
});

afterEach(() => {
  client.stopWebphone();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('startWebphone', () => {
  it('permissão ainda em `prompt`: registra o ramal sem pedir o microfone', async () => {
    await client.startWebphone(CONFIG);
    await flush();
    expect(sip.instances).toHaveLength(1);
    expect(lastUa().start).toHaveBeenCalledTimes(1);
    expect(permissionQuery).toHaveBeenCalledWith({ name: 'microphone' });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(client.getWebphoneState().mic).toBe('unknown');
  });

  it('permissão já `granted`: libera o microfone sozinho no start e acorda os AudioContext', async () => {
    setMicPermission('granted');
    const audio = await import('./webphone-audio-contexts');
    const ctx = fakeAudioContext();
    audio.registerWebphoneAudioContext(ctx);
    ctx.resume.mockClear();

    await client.startWebphone(CONFIG);
    lastUa().emit('registered');
    await flush();

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(client.getWebphoneState()).toMatchObject({ mic: 'granted', registration: 'registered' });
    expect(ctx.resume).toHaveBeenCalled();
    audio.resetWebphoneAudioContextsForTests();
  });

  it('permissão `denied`, consulta lançando ou sem `navigator.permissions`: não chama getUserMedia no start', async () => {
    for (const state of ['denied', 'throws', null] as const) {
      setMicPermission(state);
      await client.startWebphone(CONFIG);
      await flush();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(client.getWebphoneState().mic).toBe('unknown');
      client.stopWebphone();
    }
  });

  it('stop antes da consulta responder não pede o microfone', async () => {
    setMicPermission('granted');
    await client.startWebphone(CONFIG);
    client.stopWebphone();
    await flush();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('passa um instance_id UUID estável por navegador (sem urn:uuid)', async () => {
    await client.startWebphone(CONFIG);
    const first = lastUa().config.instance_id;
    expect(first).toMatch(UUID_RE);
    client.stopWebphone();
    await client.startWebphone(CONFIG);
    expect(lastUa().config.instance_id).toBe(first);
    expect(window.localStorage.getItem('enriqueceai.webphone.instance_id')).toBe(first);
  });

  it('stop no meio do start (StrictMode) não cria UA', async () => {
    const pending = client.startWebphone(CONFIG);
    client.stopWebphone();
    await pending;
    expect(sip.instances).toHaveLength(0);
  });
});

describe('requestWebphoneMicrophone', () => {
  it('negado e depois concedido no retry, sem derrubar o ramal', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    getUserMedia.mockRejectedValueOnce(domError('NotAllowedError'));
    await expect(client.requestWebphoneMicrophone()).resolves.toBe('denied');
    expect(client.getWebphoneState()).toMatchObject({ mic: 'denied', registration: 'registered' });

    await expect(client.requestWebphoneMicrophone()).resolves.toBe('granted');
    expect(client.getWebphoneState()).toMatchObject({ mic: 'granted', registration: 'registered' });
    expect(ua.stop).not.toHaveBeenCalled();
    expect(sip.instances).toHaveLength(1);
  });

  it('dispositivo ocupado vira unavailable', async () => {
    getUserMedia.mockRejectedValueOnce(domError('NotReadableError'));
    await expect(client.requestWebphoneMicrophone()).resolves.toBe('unavailable');
    expect(client.getWebphoneState().mic).toBe('unavailable');
  });

  it('dois cliques seguidos fazem um único pedido', async () => {
    const a = client.requestWebphoneMicrophone();
    const b = client.requestWebphoneMicrophone();
    expect(a).toBe(b);
    await a;
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});

describe('prepareWebphoneMicForDial (clique em Ligar)', () => {
  it('microfone não pedido: pede no clique e libera quando concede', async () => {
    await client.startWebphone(CONFIG);
    lastUa().emit('registered');
    await flush();
    const pending = client.prepareWebphoneMicForDial();
    expect(pending).not.toBeNull();
    await expect(pending).resolves.toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(client.getWebphoneState().mic).toBe('granted');
  });

  it('microfone não pedido e negado no clique: devolve a mensagem de bloqueio', async () => {
    await client.startWebphone(CONFIG);
    lastUa().emit('registered');
    await flush();
    getUserMedia.mockRejectedValueOnce(domError('NotAllowedError'));
    await expect(client.prepareWebphoneMicForDial()).resolves.toMatch(/bloqueou o microfone/);
    expect(client.getWebphoneState().mic).toBe('denied');
  });

  it('já concedido, já negado ou webphone desligado: nada a pedir (null na hora), mas acorda os AudioContext', async () => {
    const audio = await import('./webphone-audio-contexts');
    const ctx = fakeAudioContext();
    audio.registerWebphoneAudioContext(ctx);
    ctx.resume.mockClear();

    expect(client.prepareWebphoneMicForDial()).toBeNull();
    expect(ctx.resume).toHaveBeenCalledTimes(1);

    await client.startWebphone(CONFIG);
    lastUa().emit('registered');
    getUserMedia.mockRejectedValueOnce(domError('NotAllowedError'));
    await client.requestWebphoneMicrophone();
    getUserMedia.mockClear();
    expect(client.prepareWebphoneMicForDial()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    audio.resetWebphoneAudioContextsForTests();
  });

  it('"Tentar de novo" (requestWebphoneMicrophone) também acorda os AudioContext no clique', async () => {
    const audio = await import('./webphone-audio-contexts');
    const ctx = fakeAudioContext();
    audio.registerWebphoneAudioContext(ctx);
    ctx.resume.mockClear();
    await client.requestWebphoneMicrophone();
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    audio.resetWebphoneAudioContextsForTests();
  });
});

describe('auto-atendimento do INVITE integrado', () => {
  it('não atende sem o microfone concedido', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    const { session, request } = fakeSession(true);
    ua.emit('newRTCSession', { session, request });
    expect(session.answer).not.toHaveBeenCalled();
  });

  it('atende sem clique quando a permissão já era `granted` no start', async () => {
    setMicPermission('granted');
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    await flush();
    const { session, request } = fakeSession(true);
    ua.emit('newRTCSession', { session, request });
    expect(session.answer).toHaveBeenCalledTimes(1);
  });

  it('atende com o microfone concedido', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    await client.requestWebphoneMicrophone();
    const { session, request } = fakeSession(true);
    ua.emit('newRTCSession', { session, request });
    expect(session.answer).toHaveBeenCalledTimes(1);
  });
});

describe('perda do ramal para outra instância', () => {
  it('unregistered inesperado marca lost_to_other e Reconectar manda novo REGISTER no mesmo UA', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    ua.emit('unregistered', {});
    expect(client.getWebphoneState().sessionConflict).toBe('lost_to_other');
    await client.reconnectWebphone();
    expect(ua.register).toHaveBeenCalledTimes(1);
    ua.emit('registered');
    expect(client.getWebphoneState().sessionConflict).toBeNull();
  });

  it('queda de WebSocket não é perda para outra instância', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    ua.emit('disconnected', { reason: 'ws' });
    ua.emit('unregistered', {});
    expect(client.getWebphoneState().sessionConflict).toBeNull();
  });

  it('eventos do UA já parado são ignorados', async () => {
    await client.startWebphone(CONFIG);
    const ua = lastUa();
    ua.emit('registered');
    client.stopWebphone();
    ua.emit('unregistered', {});
    expect(client.getWebphoneState()).toMatchObject({
      registration: 'disabled',
      sessionConflict: null,
    });
  });
});

describe('outra aba segurando o ramal', () => {
  // BroadcastChannel falso, compartilhado no processo (cada instância é uma "aba").
  class FakeChannel {
    static all = new Set<FakeChannel>();
    listeners = new Set<(ev: { data: unknown }) => void>();
    constructor(public name: string) {
      FakeChannel.all.add(this);
    }
    postMessage(data: unknown) {
      for (const ch of FakeChannel.all)
        if (ch !== this && ch.name === this.name) for (const l of ch.listeners) l({ data });
    }
    addEventListener(_: string, l: (ev: { data: unknown }) => void) {
      this.listeners.add(l);
    }
    removeEventListener(_: string, l: (ev: { data: unknown }) => void) {
      this.listeners.delete(l);
    }
    close() {
      FakeChannel.all.delete(this);
    }
  }

  beforeEach(async () => {
    FakeChannel.all.clear();
    vi.stubGlobal('BroadcastChannel', FakeChannel);
    vi.useFakeTimers();
    client = await loadClient();
  });

  afterEach(() => vi.useRealTimers());

  it('não registra, publica other_tab, e Usar nesta aba assume', async () => {
    const otherTab = new FakeChannel('enriqueceai-webphone');
    const received: Array<{ kind: string }> = [];
    otherTab.addEventListener('message', (ev) => {
      const msg = ev.data as { kind: string };
      received.push(msg);
      if (msg.kind === 'query')
        otherTab.postMessage({ kind: 'held', ramal: '1001', tabId: 'outra' });
      if (msg.kind === 'reclaim')
        otherTab.postMessage({ kind: 'released', ramal: '1001', tabId: 'outra' });
    });

    const start = client.startWebphone(CONFIG);
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    expect(sip.instances).toHaveLength(0);
    expect(client.getWebphoneState()).toMatchObject({
      registration: 'disabled',
      sessionConflict: 'other_tab',
    });

    const takeover = client.takeOverWebphone();
    await vi.advanceTimersByTimeAsync(10);
    await takeover;
    expect(received.some((m) => m.kind === 'reclaim')).toBe(true);
    expect(sip.instances).toHaveLength(1);
    expect(lastUa().start).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('a aba que segura para o UA quando outra assume', async () => {
    const start = client.startWebphone(CONFIG);
    await vi.advanceTimersByTimeAsync(1000);
    await start;
    const ua = lastUa();
    ua.emit('registered');

    const otherTab = new FakeChannel('enriqueceai-webphone');
    const received: Array<{ kind: string }> = [];
    otherTab.addEventListener('message', (ev) => received.push(ev.data as { kind: string }));
    otherTab.postMessage({ kind: 'reclaim', ramal: '1001', tabId: 'outra' });

    expect(ua.stop).toHaveBeenCalledTimes(1);
    expect(client.getWebphoneState()).toMatchObject({
      registration: 'disabled',
      sessionConflict: 'other_tab',
    });
    expect(received.at(-1)?.kind).toBe('released');
  });
});
