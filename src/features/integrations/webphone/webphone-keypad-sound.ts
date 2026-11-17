/**
 * Bip LOCAL do teclado DTMF (retorno para o SDR). Usa um AudioContext PRÓPRIO, criado no primeiro clique:
 * não toca nos contextos do áudio da ligação (webphone-audio-contexts) e sai só pelo alto-falante local.
 * Qualquer falha de áudio é silenciosa: o envio do tom nunca depende disso.
 */
export const KEYPAD_SOUND_KEY = 'enriqueceai.webphone.keypad-sound';

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

/** `ok` = bip curto e agudo; `fail` = tom grave e mais longo. */
export function playKeypadBeep(kind: 'ok' | 'fail'): void {
  try {
    const c = getContext();
    if (!c) return;
    if (c.state === 'suspended') void c.resume().catch(() => undefined);
    const duration = kind === 'ok' ? 0.05 : 0.15;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'ok' ? 880 : 220;
    const t = c.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.05, t + 0.005);
    gain.gain.linearRampToValueAtTime(0, t + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t);
    osc.stop(t + duration + 0.01);
  } catch {
    // áudio bloqueado ou indisponível: segue sem som
  }
}

/** Padrão LIGADO; só "0" (gravado ao desligar) apaga o bip. */
export function readKeypadSound(): boolean {
  try {
    return window.localStorage.getItem(KEYPAD_SOUND_KEY) !== '0';
  } catch {
    return true;
  }
}

export function writeKeypadSound(on: boolean): void {
  try {
    window.localStorage.setItem(KEYPAD_SOUND_KEY, on ? '1' : '0');
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}
