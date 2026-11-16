import { describe, expect, it } from 'vitest';

import { TAB_LOCK_KEY, TAB_LOCK_TTL_MS, acquireTabLock, refreshTabLock, releaseTabLock } from './auto-dial-tab-lock';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: () => data.get(TAB_LOCK_KEY) ?? null,
  };
}
const rec = (tabId: string, at: number) => JSON.stringify({ tabId, at });

describe('lock de aba do motor', () => {
  it('sem lock: a primeira aba fica com ele', () => {
    const st = memoryStorage();
    expect(acquireTabLock(st, 'A', 1000)).toEqual({ ok: true });
    expect(JSON.parse(st.raw()!)).toEqual({ tabId: 'A', at: 1000 });
  });

  it('outra aba com lock vivo (<10 s) bloqueia; a mesma aba pode readquirir', () => {
    const st = memoryStorage({ [TAB_LOCK_KEY]: rec('A', 1000) });
    expect(acquireTabLock(st, 'B', 1000 + TAB_LOCK_TTL_MS - 1)).toEqual({ ok: false, holder: 'A' });
    expect(acquireTabLock(st, 'A', 2000)).toEqual({ ok: true });
  });

  it('lock abandonado (sem renovar por 10 s ou mais) é tomado', () => {
    const st = memoryStorage({ [TAB_LOCK_KEY]: rec('A', 1000) });
    expect(acquireTabLock(st, 'B', 1000 + TAB_LOCK_TTL_MS)).toEqual({ ok: true });
    expect(JSON.parse(st.raw()!).tabId).toBe('B');
  });

  it('heartbeat mantém o lock vivo; se outra aba assumiu, devolve false', () => {
    const st = memoryStorage();
    acquireTabLock(st, 'A', 1000);
    expect(refreshTabLock(st, 'A', 4000)).toBe(true);
    expect(acquireTabLock(st, 'B', 9000)).toEqual({ ok: false, holder: 'A' }); // renovado em 4000
    st.setItem(TAB_LOCK_KEY, rec('B', 5000)); // outra aba escreveu por cima
    expect(refreshTabLock(st, 'A', 6000)).toBe(false);
  });

  it('solta só o lock da PRÓPRIA aba', () => {
    const st = memoryStorage({ [TAB_LOCK_KEY]: rec('A', 1000) });
    releaseTabLock(st, 'B');
    expect(st.raw()).not.toBeNull();
    releaseTabLock(st, 'A');
    expect(st.raw()).toBeNull();
  });

  it('registro corrompido é ignorado (vira lock livre)', () => {
    const st = memoryStorage({ [TAB_LOCK_KEY]: '{lixo' });
    expect(acquireTabLock(st, 'A', 1000)).toEqual({ ok: true });
  });

  it('storage indisponível ou que lança: não dá para travar, libera (o servidor tem a trava too_soon)', () => {
    expect(acquireTabLock(null, 'A', 1)).toEqual({ ok: true });
    expect(refreshTabLock(undefined, 'A', 1)).toBe(true);
    const boom = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(acquireTabLock(boom, 'A', 1)).toEqual({ ok: true });
    expect(refreshTabLock(boom, 'A', 1)).toBe(true);
    expect(() => releaseTabLock(boom, 'A')).not.toThrow();
  });
});
