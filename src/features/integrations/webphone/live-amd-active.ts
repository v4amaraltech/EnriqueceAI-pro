/**
 * Registro da escuta ao vivo em curso nesta aba.
 *
 * O desligar precisa parar o clone da faixa e o AudioContext ANTES do BYE
 * do JsSIP. Se a limpeza ficar só no efeito que depende de `phase === 'ended'`,
 * e o clone impedir o `ended`, a UI nunca sai de "Chamando o lead".
 */

let activeStop: (() => void) | null = null;

/** Registra o stop da escuta atual. Uma nova escuta substitui a anterior. */
export function setActiveLiveAmdStop(stop: (() => void) | null): void {
  activeStop = stop;
}

/** Para a escuta em curso, se houver. Idempotente. */
export function stopActiveLiveAmd(): void {
  const stop = activeStop;
  activeStop = null;
  stop?.();
}

/** Só para testes. */
export function peekActiveLiveAmdStop(): (() => void) | null {
  return activeStop;
}
