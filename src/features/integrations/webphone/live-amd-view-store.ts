import type { LiveAmdView } from './live-amd-session';

type Listener = (callId: string, view: LiveAmdView) => void;

let current: { callId: string; view: LiveAmdView } | null = null;
const listeners = new Set<Listener>();

/** Publica a visão atual da escuta ao vivo para outros painéis da mesma aba. */
export function publishLiveAmdView(callId: string, view: LiveAmdView): void {
  current = { callId, view };
  listeners.forEach((listener) => listener(callId, view));
}

export function getLiveAmdView(callId: string | null | undefined): LiveAmdView | null {
  if (!callId || current?.callId !== callId) return null;
  return current.view;
}

export function subscribeLiveAmdView(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Só para testes. */
export function resetLiveAmdViewStore(): void {
  current = null;
  listeners.clear();
}
