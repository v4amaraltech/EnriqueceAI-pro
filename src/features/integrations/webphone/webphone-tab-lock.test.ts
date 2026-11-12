import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  LOCK_HEARTBEAT_MS,
  LOCK_PROBE_MS,
  LOCK_TAKEOVER_WAIT_MS,
  LOCK_TTL_MS,
  type LockBus,
  type LockClock,
  type LockMessage,
  createWebphoneTabLock,
} from './webphone-tab-lock';

// Canal falso: entrega para todos os outros assinantes (como o BroadcastChannel,
// que não devolve a mensagem para quem mandou).
function createHub() {
  const subs = new Set<{ owner: LockBus; handler: (m: LockMessage) => void }>();
  const log: LockMessage[] = [];
  function bus(): LockBus {
    const self: LockBus = {
      post(message) {
        log.push(message);
        for (const s of [...subs]) if (s.owner !== self) s.handler(message);
      },
      subscribe(handler) {
        const entry = { owner: self, handler };
        subs.add(entry);
        return () => subs.delete(entry);
      },
    };
    return self;
  }
  return { bus, log };
}

const clock: LockClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

async function settle<T>(promise: Promise<T>, ms: number): Promise<T> {
  await vi.advanceTimersByTimeAsync(ms);
  return promise;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createWebphoneTabLock', () => {
  it('a primeira aba registra; a segunda vê que o ramal está em uso e não registra', async () => {
    const hub = createHub();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    expect(await settle(a.acquire(), LOCK_PROBE_MS)).toBe('acquired');
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('held_elsewhere');
    expect(a.isHolding()).toBe(true);
    expect(b.isHolding()).toBe(false);
  });

  it('ramais diferentes no mesmo navegador não se misturam', async () => {
    const hub = createHub();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    const b = createWebphoneTabLock({
      ramal: '1002',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    await settle(a.acquire(), LOCK_PROBE_MS);
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('acquired');
  });

  it('reclaim transfere o controle: a anterior para (onLost) e responde released', async () => {
    const hub = createHub();
    const lostA = vi.fn();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: lostA,
    });
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    await settle(a.acquire(), LOCK_PROBE_MS);
    await settle(b.acquire(), LOCK_PROBE_MS);

    const order: string[] = [];
    lostA.mockImplementation(() => order.push('a parou o UA'));
    const takeover = b.takeover();
    expect(await settle(takeover, 0)).toBe(true);
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(a.isHolding()).toBe(false);
    expect(b.isHolding()).toBe(true);
    expect(hub.log.filter((m) => m.tabId === 'a').at(-1)?.kind).toBe('released');
    // Agora é a vez da A ver o ramal ocupado.
    expect(await settle(a.acquire(), LOCK_PROBE_MS)).toBe('held_elsewhere');
  });

  it('heartbeat atrasado da aba que perdeu não derruba quem assumiu', async () => {
    const hub = createHub();
    const old = hub.bus();
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    old.post({ kind: 'held', ramal: '1001', tabId: 'a' });
    const takeover = b.takeover();
    old.post({ kind: 'held', ramal: '1001', tabId: 'a' });
    expect(b.isHolding()).toBe(true);
    expect(hub.log.at(-1)).toEqual({ kind: 'reclaim', ramal: '1001', tabId: 'b' });
    old.post({ kind: 'released', ramal: '1001', tabId: 'a' });
    expect(await settle(takeover, 0)).toBe(true);
  });

  it('takeover sem resposta da outra aba (morta) segue depois do tempo máximo', async () => {
    const hub = createHub();
    const deadBus = hub.bus();
    // Aba morta: só mandou um heartbeat e sumiu.
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    deadBus.post({ kind: 'held', ramal: '1001', tabId: 'a' });
    const takeover = b.takeover();
    let done = false;
    void takeover.then(() => (done = true));
    await vi.advanceTimersByTimeAsync(LOCK_TAKEOVER_WAIT_MS - 1);
    expect(done).toBe(false);
    expect(await settle(takeover, 1)).toBe(true);
  });

  it('heartbeat expirado libera o ramal para a próxima aba', async () => {
    const hub = createHub();
    const dead = hub.bus();
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    dead.post({ kind: 'held', ramal: '1001', tabId: 'a' });
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('held_elsewhere');
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS);
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('acquired');
  });

  it('quem segura manda heartbeat e mantém a outra aba bloqueada além do TTL', async () => {
    const hub = createHub();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    await settle(a.acquire(), LOCK_PROBE_MS);
    await vi.advanceTimersByTimeAsync(LOCK_TTL_MS * 3);
    expect(hub.log.filter((m) => m.kind === 'held').length).toBeGreaterThanOrEqual(
      Math.floor((LOCK_TTL_MS * 3) / LOCK_HEARTBEAT_MS),
    );
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('held_elsewhere');
  });

  it('release (stop/pagehide) avisa as outras abas e para o heartbeat', async () => {
    const hub = createHub();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    await settle(a.acquire(), LOCK_PROBE_MS);
    a.release();
    expect(hub.log.at(-1)).toEqual({ kind: 'released', ramal: '1001', tabId: 'a' });
    const before = hub.log.length;
    await vi.advanceTimersByTimeAsync(LOCK_HEARTBEAT_MS * 2);
    expect(hub.log.length).toBe(before);
    expect(await settle(b.acquire(), LOCK_PROBE_MS)).toBe('acquired');
  });

  it('release durante o acquire cancela (StrictMode: mount/unmount/mount)', async () => {
    const hub = createHub();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: vi.fn(),
    });
    const first = a.acquire();
    a.release();
    const second = a.acquire();
    await vi.advanceTimersByTimeAsync(LOCK_PROBE_MS);
    expect(await first).toBe('cancelled');
    expect(await second).toBe('acquired');
    expect(a.isHolding()).toBe(true);

    a.release();
    const third = a.acquire();
    a.release();
    expect(await settle(third, LOCK_PROBE_MS)).toBe('cancelled');
    expect(a.isHolding()).toBe(false);
  });

  it('duas abas segurando ao mesmo tempo: fica só uma', async () => {
    const hub = createHub();
    const lostA = vi.fn();
    const lostB = vi.fn();
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: hub.bus(),
      clock,
      onLost: lostA,
    });
    const b = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'b',
      bus: hub.bus(),
      clock,
      onLost: lostB,
    });
    const pa = a.acquire();
    const pb = b.acquire();
    await vi.advanceTimersByTimeAsync(LOCK_PROBE_MS);
    await Promise.all([pa, pb]);
    expect([a.isHolding(), b.isHolding()].filter(Boolean)).toHaveLength(1);
    expect(lostA.mock.calls.length + lostB.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('sem BroadcastChannel registra direto', async () => {
    const a = createWebphoneTabLock({
      ramal: '1001',
      tabId: 'a',
      bus: null,
      clock,
      onLost: vi.fn(),
    });
    expect(await a.acquire()).toBe('acquired');
  });
});
