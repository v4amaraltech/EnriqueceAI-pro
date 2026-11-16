/**
 * Uma aba só por navegador roda o motor (disparo duplo: duas abas do mesmo SDR). Lock em `localStorage` com batimento
 * (heartbeat): o dono renova o registro; sem renovar por `TAB_LOCK_TTL_MS` o lock vale como abandonado (aba fechada ou
 * travada). Funções PURAS sobre um `storage` e um relógio injetados. NÃO guarda "motor ligado": o motor continua nascendo
 * Desligado (D8) e só toca no storage depois do Iniciar.
 * Storage indisponível (aba privada, bloqueado) = não dá para travar: libera (o servidor ainda tem a trava `too_soon`).
 */
export const TAB_LOCK_KEY = 'enriqueceai.cockpit-auto-dial.tab-lock.v1';
export const TAB_LOCK_TTL_MS = 10_000;
export const TAB_LOCK_HEARTBEAT_MS = 3_000;

type LockStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
interface LockRecord {
  tabId: string;
  at: number;
}

function read(storage: LockStorage): LockRecord | null {
  const raw = storage.getItem(TAB_LOCK_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LockRecord>;
    return typeof v.tabId === 'string' && typeof v.at === 'number' ? { tabId: v.tabId, at: v.at } : null;
  } catch {
    return null;
  }
}

export type TabLockResult = { ok: true } | { ok: false; holder: string };

/** Tenta ficar com o lock. Falha se OUTRA aba o renovou há menos de `ttlMs`. */
export function acquireTabLock(storage: LockStorage | null | undefined, tabId: string, nowMs: number, ttlMs: number = TAB_LOCK_TTL_MS): TabLockResult {
  if (!storage) return { ok: true };
  try {
    const current = read(storage);
    if (current && current.tabId !== tabId && nowMs - current.at < ttlMs) return { ok: false, holder: current.tabId };
    storage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId, at: nowMs } satisfies LockRecord));
    // Releitura: se duas abas escreveram quase juntas, só a última escrita fica.
    const after = read(storage);
    return after && after.tabId !== tabId ? { ok: false, holder: after.tabId } : { ok: true };
  } catch {
    return { ok: true };
  }
}

/** Renova o lock. `false` = outra aba assumiu (esta deve parar). */
export function refreshTabLock(storage: LockStorage | null | undefined, tabId: string, nowMs: number): boolean {
  if (!storage) return true;
  try {
    const current = read(storage);
    if (current && current.tabId !== tabId) return false;
    storage.setItem(TAB_LOCK_KEY, JSON.stringify({ tabId, at: nowMs } satisfies LockRecord));
    return true;
  } catch {
    return true;
  }
}

/** Solta o lock, mas só se for desta aba (nunca apaga o de outra). */
export function releaseTabLock(storage: LockStorage | null | undefined, tabId: string): void {
  if (!storage) return;
  try {
    const current = read(storage);
    if (current && current.tabId === tabId) storage.removeItem(TAB_LOCK_KEY);
  } catch {
    /* sem storage: nada a soltar */
  }
}

export const TAB_LOCK_MESSAGE = 'O motor já está rodando em outra aba.';
