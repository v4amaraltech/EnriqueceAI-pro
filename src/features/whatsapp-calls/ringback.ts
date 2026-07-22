/**
 * Tom de chamada (ringback) local para a Ligação via WhatsApp.
 *
 * POR QUE ISSO EXISTE: o WhatsApp NÃO envia áudio de chamada pela perna WebRTC
 * enquanto o lead não atende — as trilhas remotas chegam `muted`. Sem isso, o
 * SDR fica em silêncio absoluto durante o "Chamando...", sem saber se está
 * tocando, travou ou caiu. Geramos o tom localmente, como um telefone comum.
 *
 * Padrão brasileiro (Anatel): 425 Hz, 1s ligado / 4s em silêncio, em loop.
 *
 * Áudio gerado por Web Audio (sem arquivo externo). O AudioContext nasce do
 * clique em "Ligar", então a política de autoplay do Chrome permite tocar.
 */

const RINGBACK_FREQ_HZ = 425;
const TONE_ON_SECONDS = 1;
const CYCLE_SECONDS = 5; // 1s de tom + 4s de silêncio
/** Volume discreto — o tom é feedback, não pode competir com a voz do lead. */
const PEAK_GAIN = 0.12;

export interface Ringback {
  /** Para o tom e libera o AudioContext. Idempotente. */
  stop: () => void;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Inicia o tom de chamada em loop. Retorna um handle com `stop()`.
 *
 * Nunca lança: se o navegador não suportar Web Audio (ou o contexto falhar),
 * devolve um no-op — silêncio é degradação aceitável, jamais quebrar a ligação.
 */
export function startRingback(): Ringback {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return { stop: () => {} };

  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return { stop: () => {} };
  }

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const nodes: { osc: OscillatorNode; gain: GainNode }[] = [];

  /** Agenda um beep de TONE_ON_SECONDS começando em `at` (tempo do contexto). */
  function scheduleBeep(at: number): void {
    if (stopped) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = RINGBACK_FREQ_HZ;

    // Ataque/decaimento curtos evitam o "clique" de ligar/desligar abruptamente.
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(PEAK_GAIN, at + 0.02);
    gain.gain.setValueAtTime(PEAK_GAIN, at + TONE_ON_SECONDS - 0.02);
    gain.gain.linearRampToValueAtTime(0, at + TONE_ON_SECONDS);

    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + TONE_ON_SECONDS);

    const entry = { osc, gain };
    nodes.push(entry);
    osc.onended = () => {
      const i = nodes.indexOf(entry);
      if (i >= 0) nodes.splice(i, 1);
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        // já desconectado
      }
    };
  }

  // Primeiro toque imediato + repetição a cada ciclo.
  scheduleBeep(ctx.currentTime);
  timer = setInterval(() => scheduleBeep(ctx.currentTime), CYCLE_SECONDS * 1000);

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      for (const { osc, gain } of [...nodes]) {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
        } catch {
          // oscilador já encerrado
        }
      }
      nodes.length = 0;
      void ctx.close().catch(() => {});
    },
  };
}
