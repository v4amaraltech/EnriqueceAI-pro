// Trava entre abas do webphone (mesmo navegador, mesmo origin).
//
// A API4COM é singleton por ramal: "uma segunda aba ou navegador com o mesmo
// ramal desconecta a anterior". Duas abas registrando ao mesmo tempo entram
// numa corrida de REGISTER que derruba a outra no meio da ligação. Esta trava
// coordena as abas por `BroadcastChannel` ANTES do `UA.start()`:
//
// - `acquire()`: pergunta no canal se alguma aba segura o ramal. Se alguém
//   responder (ou mandou heartbeat recente), esta aba NÃO registra.
// - Quem segura manda heartbeat periódico e responde às perguntas.
// - `takeover()` ("Usar nesta aba"): manda `reclaim`; quem segurava para o UA
//   de forma limpa e responde `released`. Esta aba espera esse `released` (ou
//   um tempo máximo, se a outra aba morreu) antes de registrar, para o
//   un-REGISTER da outra chegar antes do nosso REGISTER.
// - `release()`: no stop e no `pagehide`. As outras abas NUNCA registram
//   sozinhas ao ver `released` (só pelo clique), então liberar já no stop não
//   abre corrida no mount/unmount/mount do StrictMode; um `acquire` ainda em
//   andamento é cancelado pelo `release` (contador de tentativa).
//
// Módulo puro: o canal e os timers são injetados (testável sem BroadcastChannel).

export const WEBPHONE_LOCK_CHANNEL = 'enriqueceai-webphone';
export const LOCK_HEARTBEAT_MS = 2000;
/** Sem heartbeat por este tempo, a aba que segurava é considerada morta. */
export const LOCK_TTL_MS = 6000;
/** Quanto `acquire` espera resposta de uma aba que já segura o ramal. */
export const LOCK_PROBE_MS = 400;
/** Quanto `takeover` espera o `released` da aba anterior. */
export const LOCK_TAKEOVER_WAIT_MS = 2500;

export type LockMessage =
  | { kind: 'query'; ramal: string; tabId: string }
  | { kind: 'held'; ramal: string; tabId: string }
  | { kind: 'reclaim'; ramal: string; tabId: string }
  | { kind: 'released'; ramal: string; tabId: string };

export interface LockBus {
  post(message: LockMessage): void;
  subscribe(handler: (message: LockMessage) => void): () => void;
}

export interface LockClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export type AcquireResult = 'acquired' | 'held_elsewhere' | 'cancelled';

export interface WebphoneTabLock {
  readonly ramal: string;
  acquire(): Promise<AcquireResult>;
  /** Assume o ramal. Resolve quando a aba anterior liberou (ou no tempo máximo); `false` se cancelado. */
  takeover(): Promise<boolean>;
  release(): void;
  isHolding(): boolean;
  dispose(): void;
}

export interface TabLockOptions {
  ramal: string;
  tabId: string;
  bus: LockBus | null;
  clock: LockClock;
  /** Outra aba assumiu o ramal: pare o UA desta aba. Chamado antes de responder `released`. */
  onLost: () => void;
}

function isLockMessage(value: unknown): value is LockMessage {
  if (!value || typeof value !== 'object') return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.ramal === 'string' &&
    typeof m.tabId === 'string' &&
    (m.kind === 'query' || m.kind === 'held' || m.kind === 'reclaim' || m.kind === 'released')
  );
}

export function createWebphoneTabLock(options: TabLockOptions): WebphoneTabLock {
  const { ramal, tabId, bus, clock, onLost } = options;
  let holding = false;
  // Segurando por "Usar nesta aba": vence qualquer outra aba que ainda diga segurar.
  let heldByTakeover = false;
  let heartbeat: unknown = null;
  // Última aba que disse segurar o ramal (e quando).
  let otherHolder: { tabId: string; at: number } | null = null;
  // Cada release/acquire/takeover invalida as esperas anteriores.
  let attempt = 0;
  let takeoverWaiter: (() => void) | null = null;

  const post = (kind: LockMessage['kind']) => bus?.post({ kind, ramal, tabId });

  function otherHolderAlive(): boolean {
    return otherHolder !== null && clock.now() - otherHolder.at < LOCK_TTL_MS;
  }

  function startHolding(byTakeover: boolean): void {
    holding = true;
    heldByTakeover = byTakeover;
    otherHolder = null;
    if (heartbeat === null) heartbeat = clock.setInterval(() => post('held'), LOCK_HEARTBEAT_MS);
    // No takeover o primeiro aviso é o `reclaim`, não um `held`.
    if (!byTakeover) post('held');
  }

  function stopHolding(): void {
    holding = false;
    heldByTakeover = false;
    if (heartbeat !== null) {
      clock.clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  function lose(byTabId: string): void {
    stopHolding();
    otherHolder = { tabId: byTabId, at: clock.now() };
    try {
      onLost();
    } finally {
      post('released');
    }
  }

  function release(): void {
    attempt++;
    if (takeoverWaiter) takeoverWaiter();
    if (!holding) return;
    stopHolding();
    post('released');
  }

  const unsubscribe = bus?.subscribe((raw) => {
    if (!isLockMessage(raw) || raw.ramal !== ramal || raw.tabId === tabId) return;
    switch (raw.kind) {
      case 'query':
        if (holding) post('held');
        return;
      case 'held':
        if (holding) {
          // Heartbeat atrasado de quem perdeu para o nosso takeover: reafirma.
          if (heldByTakeover) post('reclaim');
          // Duas abas segurando por acquire (corrida rara): fica a de menor tabId.
          else if (raw.tabId < tabId) lose(raw.tabId);
          else post('held');
          return;
        }
        otherHolder = { tabId: raw.tabId, at: clock.now() };
        return;
      case 'reclaim':
        if (holding) lose(raw.tabId);
        else otherHolder = { tabId: raw.tabId, at: clock.now() };
        return;
      case 'released':
        if (otherHolder?.tabId === raw.tabId) otherHolder = null;
        if (takeoverWaiter) takeoverWaiter();
        return;
    }
  });

  return {
    ramal,
    isHolding: () => holding,
    acquire() {
      const mine = ++attempt;
      if (holding) return Promise.resolve('acquired');
      if (!bus) {
        startHolding(false);
        return Promise.resolve('acquired');
      }
      if (otherHolderAlive()) return Promise.resolve('held_elsewhere');
      post('query');
      return new Promise<AcquireResult>((resolve) => {
        clock.setTimeout(() => {
          if (mine !== attempt) return resolve('cancelled');
          if (otherHolderAlive()) return resolve('held_elsewhere');
          startHolding(false);
          resolve('acquired');
        }, LOCK_PROBE_MS);
      });
    },
    takeover() {
      const mine = ++attempt;
      const hadOther = otherHolderAlive();
      startHolding(true);
      if (!bus || !hadOther) {
        post('reclaim');
        return Promise.resolve(true);
      }
      // A espera é armada ANTES do `reclaim`: o `released` pode chegar logo.
      return new Promise<boolean>((resolve) => {
        const done = () => {
          if (takeoverWaiter === done) takeoverWaiter = null;
          clock.clearTimeout(timer);
          resolve(mine === attempt && holding);
        };
        const timer = clock.setTimeout(done, LOCK_TAKEOVER_WAIT_MS);
        takeoverWaiter = done;
        post('reclaim');
      });
    },
    release,
    dispose() {
      release();
      unsubscribe?.();
    },
  };
}

/** `BroadcastChannel` como `LockBus`, ou null se o navegador não tiver. */
export function broadcastLockBus(name = WEBPHONE_LOCK_CHANNEL): LockBus | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(name);
  } catch {
    return null;
  }
  return {
    post(message) {
      try {
        channel.postMessage(message);
      } catch {
        /* canal fechado */
      }
    },
    subscribe(handler) {
      const listener = (ev: MessageEvent) => handler(ev.data as LockMessage);
      channel.addEventListener('message', listener);
      return () => {
        channel.removeEventListener('message', listener);
        channel.close();
      };
    },
  };
}

export const browserLockClock: LockClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (h) => window.clearTimeout(h as number),
  setInterval: (fn, ms) => window.setInterval(fn, ms),
  clearInterval: (h) => window.clearInterval(h as number),
};
