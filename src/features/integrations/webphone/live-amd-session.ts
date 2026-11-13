import { classifyLiveAmd, type LiveAmdDecision, type LiveAmdLabel } from '@/features/calls/live-amd-phrases';

import { LIVE_AMD_SAMPLE_RATE, LIVE_AMD_WINDOW_MS } from './assemblyai-streaming';
import { createSlidingPcmQueue, createTranscriptLog, type TranscriptWord } from './live-amd-window';

export type NextActivitySuggestion = 'schedule_meeting' | 'schedule_callback' | 'not_connected';

export interface LiveAmdView {
  prediction: LiveAmdLabel | 'unknown';
  phrase: string | null;
  confidence: number;
  latencyMs: number;
  transcript: string;
  nextActivity: NextActivitySuggestion | null;
  nextActivityReason: string | null;
}

/** Estado do AudioContext da captura. `unknown` quando o pump não informa. */
export type LiveAmdAudioContextState = 'running' | 'suspended' | 'closed' | 'interrupted' | 'unknown';

/** Caminho que entregou o áudio: AudioWorklet, ScriptProcessor (fallback) ou nenhum. */
export type LiveAmdPumpKind = 'worklet' | 'script_processor' | 'none' | 'custom';

/**
 * Por que a transcrição ficou vazia (nulo quando há texto). Ordem de checagem,
 * do áudio para a rede: contexto nunca rodou, entrada sem energia, erro ou
 * fechamento antecipado do socket, Begin que não chegou, socket que nunca abriu.
 * `no_speech` é o resto: áudio com energia, Begin recebido e nenhum texto.
 */
export type LiveAmdEmptyReason = 'context_suspended' | 'silent_input' | 'ws_error' | 'no_begin' | 'no_socket' | 'no_speech';

/**
 * Telemetria da escuta, gravada em calls.metadata.live_amd para diagnosticar
 * transcrição vazia. Energia (rms) na escala 0 a 1 (amostra int16 / 32768).
 */
export interface LiveAmdTelemetry {
  bytesSent: number;
  frames: number;
  rmsAvg: number;
  rmsPeak: number;
  audioContextState: LiveAmdAudioContextState;
  beginReceived: boolean;
  turnCount: number;
  messageCount: number;
  wsError: boolean;
  emptyReason: LiveAmdEmptyReason | null;
  trackCloned: boolean | null;
  pump: LiveAmdPumpKind | null;
}

export interface LiveAmdEffect {
  view: LiveAmdView | null;
  record: boolean;
  requestNextActivity: boolean;
  closeSocket: boolean;
  /** PCM ainda não enviado e que ainda cabe nos últimos 15 segundos. */
  send: ArrayBuffer | null;
}

const CLEAR_SIGNAL = new Set<LiveAmdLabel>(['voicemail', 'no_answer', 'number_not_exist']);
const PCM_ENERGY_FLOOR = 400;

function pcmHasEnergy(pcm: Int16Array): boolean {
  if (pcm.length === 0) return false;
  const step = Math.max(1, Math.floor(pcm.length / 200));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < pcm.length; i += step) {
    sum += Math.abs(pcm[i] ?? 0);
    count += 1;
  }
  return count > 0 && sum / count >= PCM_ENERGY_FLOOR;
}

/** RMS do bloco na escala 0 a 1. */
function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = (pcm[i] ?? 0) / 0x8000;
    sum += v * v;
  }
  return Math.sqrt(sum / pcm.length);
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function emptyEffect(send: ArrayBuffer | null = null): LiveAmdEffect {
  return { view: null, record: false, requestNextActivity: false, closeSocket: false, send };
}

interface TurnMessage {
  type?: string;
  error?: unknown;
  transcript?: string;
  end_of_turn?: boolean;
  words?: Array<{ text?: string; end?: number }>;
}

function wordsFromTurn(message: TurnMessage, audioMs: number): TranscriptWord[] {
  if (Array.isArray(message.words) && message.words.length > 0) {
    return message.words
      .filter((word) => typeof word.text === 'string')
      .map((word) => ({ text: word.text ?? '', endMs: typeof word.end === 'number' ? word.end : audioMs }));
  }
  if (typeof message.transcript === 'string' && message.transcript.trim()) {
    return [{ text: message.transcript, endMs: audioMs }];
  }
  return [];
}

/**
 * Escuta a ligação inteira. O que tem mais de 15 segundos e ainda não foi
 * enviado é descartado. A classe (atendeu, não atendeu, caixa postal, número
 * inexistente) olha só o texto dos últimos 15 segundos. O texto acumulado
 * fica para a sugestão de próxima atividade no fim, ou quando a classe fecha.
 */
export function createLiveAmdSession(now: () => number) {
  const queue = createSlidingPcmQueue();
  const transcript = createTranscriptLog();
  let samplesSeen = 0;
  // O socket aberto não libera o envio: só o Begin da AssemblyAI libera.
  let socketOpened = false;
  let begun = false;
  let wsError = false;
  let contextState: LiveAmdAudioContextState = 'unknown';
  let contextEverRan = false;
  let bytesSent = 0;
  let frames = 0;
  let rmsSum = 0;
  let rmsPeak = 0;
  let turnCount = 0;
  let messageCount = 0;
  let trackCloned: boolean | null = null;
  let pumpKind: LiveAmdPumpKind | null = null;
  let audioStartedAt: number | null = null;
  let lastDecision: LiveAmdDecision = { label: 'unknown', phrase: null, confidence: 0 };
  let activityRequested = false;
  let closed = false;
  let lastEnergyAtMs: number | null = null;

  const audioMs = () => Math.round((samplesSeen / LIVE_AMD_SAMPLE_RATE) * 1000);

  const windowHadEnergy = (clock: number) => lastEnergyAtMs !== null && clock - lastEnergyAtMs <= LIVE_AMD_WINDOW_MS;

  // Contexto suspenso ou fechado não libera envio. `unknown` (pump sem
  // AudioContext, como nos testes) não bloqueia.
  const contextAllowsSend = () => contextState === 'running' || contextState === 'unknown';
  const canSend = () => !closed && begun && contextAllowsSend();

  function emptyReason(): LiveAmdEmptyReason | null {
    if (transcript.fullText()) return null;
    const contextBlocked = contextState === 'suspended' || contextState === 'closed' || contextState === 'interrupted';
    if (!contextEverRan && contextBlocked) return 'context_suspended';
    if (!windowHadEnergy(audioMs())) return 'silent_input';
    if (wsError) return 'ws_error';
    if (socketOpened && !begun) return 'no_begin';
    if (!socketOpened) return 'no_socket';
    return 'no_speech';
  }

  function viewFor(decision: LiveAmdDecision): LiveAmdView {
    const started = audioStartedAt ?? now();
    return {
      prediction: decision.label,
      phrase: decision.phrase,
      confidence: decision.confidence,
      latencyMs: Math.max(0, now() - started),
      transcript: transcript.fullText(),
      nextActivity: null,
      nextActivityReason: null,
    };
  }

  function decide(forceElapsed: boolean): LiveAmdEffect {
    const clock = audioMs();
    const recent = transcript.textSince(clock - LIVE_AMD_WINDOW_MS);
    const elapsedMs = recent ? 0 : forceElapsed || clock >= LIVE_AMD_WINDOW_MS ? LIVE_AMD_WINDOW_MS : clock;
    const decision = classifyLiveAmd({ transcript: recent, elapsedMs, hadEnergy: windowHadEnergy(clock) });
    const changed = decision.label !== lastDecision.label || decision.phrase !== lastDecision.phrase;
    lastDecision = decision;
    const clear = CLEAR_SIGNAL.has(decision.label as LiveAmdLabel);
    const requestNextActivity = clear && !activityRequested;
    if (requestNextActivity) activityRequested = true;
    const shouldRecord = decision.label !== 'unknown' && (changed || requestNextActivity);
    if (!shouldRecord && !requestNextActivity) return emptyEffect();
    return {
      view: viewFor(decision),
      record: shouldRecord,
      requestNextActivity,
      closeSocket: false,
      send: null,
    };
  }

  return {
    onPcm(pcm: Int16Array): LiveAmdEffect {
      if (closed || pcm.length === 0) return emptyEffect();
      if (audioStartedAt === null) audioStartedAt = now();
      samplesSeen += pcm.length;
      frames += 1;
      const rms = pcmRms(pcm);
      rmsSum += rms;
      if (rms > rmsPeak) rmsPeak = rms;
      if (pcmHasEnergy(pcm)) lastEnergyAtMs = audioMs();
      queue.push(pcm);
      const send = canSend() ? queue.drain() : null;
      const decision = decide(false);
      return { ...decision, send };
    },
    /** O socket abriu. Não envia nada: o áudio espera o Begin. */
    onSocketOpen(): void {
      socketOpened = true;
    },
    /** Erro do socket, ou fechamento antes do fim da ligação. */
    onSocketError(): void {
      if (!closed) wsError = true;
    },
    /** Último estado do AudioContext da captura. Ao voltar a rodar, solta a fila se o Begin já veio. */
    onAudioContextState(state: LiveAmdAudioContextState): LiveAmdEffect {
      contextState = state;
      if (state === 'running') contextEverRan = true;
      return emptyEffect(canSend() ? queue.drain() : null);
    },
    /** Caminho do áudio (worklet ou fallback) e se a faixa foi clonada. */
    onPumpInfo(info: { pump: LiveAmdPumpKind; trackCloned: boolean | null }): void {
      pumpKind = info.pump;
      trackCloned = info.trackCloned;
    },
    /** Bytes que de fato saíram pelo socket. */
    onBytesSent(bytes: number): void {
      bytesSent += bytes;
    },
    telemetry(): LiveAmdTelemetry {
      return {
        bytesSent,
        frames,
        rmsAvg: frames > 0 ? round4(rmsSum / frames) : 0,
        rmsPeak: round4(rmsPeak),
        audioContextState: contextState,
        beginReceived: begun,
        turnCount,
        messageCount,
        wsError,
        emptyReason: emptyReason(),
        trackCloned,
        pump: pumpKind,
      };
    },
    onMessage(raw: string): LiveAmdEffect {
      if (closed) return emptyEffect();
      let message: TurnMessage;
      try {
        message = JSON.parse(raw) as TurnMessage;
      } catch {
        return emptyEffect();
      }
      messageCount += 1;
      if (message.type === 'Begin') {
        begun = true;
        // Entrega o que ficou na fila (no máximo os últimos 15 segundos).
        return emptyEffect(canSend() ? queue.drain() : null);
      }
      if (message.type !== 'Turn') {
        if (message.error !== undefined) wsError = true;
        return emptyEffect();
      }
      turnCount += 1;
      transcript.applyTurn(wordsFromTurn(message, audioMs()), message.end_of_turn === true);
      return decide(false);
    },
    onCallEnded(): LiveAmdEffect {
      if (closed) return emptyEffect();
      closed = true;
      const clock = audioMs();
      const recent = transcript.textSince(Math.max(0, clock - LIVE_AMD_WINDOW_MS));
      const decision = classifyLiveAmd({
        transcript: recent,
        elapsedMs: recent ? 0 : LIVE_AMD_WINDOW_MS,
        hadEnergy: windowHadEnergy(clock),
      });
      lastDecision = decision;
      const requestNextActivity = !activityRequested;
      activityRequested = true;
      return {
        view: viewFor(decision),
        record: true,
        requestNextActivity,
        closeSocket: true,
        send: null,
      };
    },
  };
}
