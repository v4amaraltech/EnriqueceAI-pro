// Observa a faixa remota do JsSIP no navegador e registra só o instante em
// que o áudio chegou. Não envia amostras, não abre socket e não chama a API.

import { registerWebphoneAudioContext } from './webphone-audio-contexts';

export interface RemoteAudioSnapshot {
  callId: string;
  startedAt: number;
  firstFrameAt: number | null;
  lastFrameAt: number | null;
  frames: number;
  msToFirstFrame: number | null;
}

export interface AudioSampler {
  read(): ArrayLike<number>;
}

export interface RemoteAudioWatch {
  callId: string;
  startedAt: number;
  sampler: AudioSampler;
  now: () => number;
  schedule: (tick: () => void) => number;
  cancel: (id: number) => void;
  report: (event: 'chegou' | 'encerrou', snapshot: RemoteAudioSnapshot) => void;
}

const SILENCE_CENTER = 128;
const SIGNAL_FLOOR = 0.02;

/** Energia do AnalyserNode em bytes de domínio do tempo (centro em 128). */
export function timeDomainHasSignal(bytes: ArrayLike<number>, floor = SIGNAL_FLOOR): boolean {
  if (bytes.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) sum += Math.abs((bytes[i] ?? SILENCE_CENTER) - SILENCE_CENTER);
  return sum / bytes.length / SILENCE_CENTER >= floor;
}

export function shouldTapRemoteAudio(liveListen: boolean | undefined, trackKind: string): boolean {
  return liveListen === true && trackKind === 'audio';
}

export function createRemoteAudioLog(callId: string, startedAt: number) {
  let firstFrameAt: number | null = null;
  let lastFrameAt: number | null = null;
  let frames = 0;

  const snapshot = (): RemoteAudioSnapshot => ({
    callId,
    startedAt,
    firstFrameAt,
    lastFrameAt,
    frames,
    msToFirstFrame: firstFrameAt === null ? null : firstFrameAt - startedAt,
  });

  return {
    noteSignal(at: number, audible: boolean): RemoteAudioSnapshot {
      if (!audible) return snapshot();
      frames += 1;
      if (firstFrameAt === null) firstFrameAt = at;
      lastFrameAt = at;
      return snapshot();
    },
    snapshot,
  };
}

/**
 * Amostra a faixa em loop local. O relatório da primeira amostra audível sai
 * uma vez. O encerramento devolve o total. O callback `report` é o único
 * efeito: o chamador deve logar no console, nunca na rede.
 */
export function watchRemoteAudio(options: RemoteAudioWatch): () => void {
  const log = createRemoteAudioLog(options.callId, options.startedAt);
  let announced = false;
  let stopped = false;
  let timer = 0;

  const tick = () => {
    if (stopped) return;
    const snap = log.noteSignal(options.now(), timeDomainHasSignal(options.sampler.read()));
    if (!announced && snap.firstFrameAt !== null) {
      announced = true;
      options.report('chegou', snap);
    }
    timer = options.schedule(tick);
  };

  timer = options.schedule(tick);

  return () => {
    if (stopped) return;
    stopped = true;
    options.cancel(timer);
    options.report('encerrou', log.snapshot());
  };
}

function defaultReport(event: 'chegou' | 'encerrou', snapshot: RemoteAudioSnapshot): void {
  console.warn('[webphone-live-amd] faixa remota', event, {
    callId: snapshot.callId,
    msToFirstFrame: snapshot.msToFirstFrame,
    frames: snapshot.frames,
  });
}

/** Liga o AnalyserNode na faixa remota. Ganho zero para não tocar o áudio duas vezes. */
export function watchRemoteTrack(
  track: MediaStreamTrack,
  callId: string,
  report: RemoteAudioWatch['report'] = defaultReport,
): () => void {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return () => undefined;
  const ctx = new window.AudioContext();
  const unregister = registerWebphoneAudioContext(ctx);
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(analyser);
  analyser.connect(silent);
  silent.connect(ctx.destination);
  const bins = new Uint8Array(analyser.fftSize);
  const stop = watchRemoteAudio({
    callId,
    startedAt: Date.now(),
    sampler: {
      read() {
        analyser.getByteTimeDomainData(bins);
        return bins;
      },
    },
    now: () => Date.now(),
    schedule: (tick) => window.requestAnimationFrame(tick),
    cancel: (id) => window.cancelAnimationFrame(id),
    report,
  });
  return () => {
    stop();
    source.disconnect();
    unregister();
    void ctx.close();
  };
}
