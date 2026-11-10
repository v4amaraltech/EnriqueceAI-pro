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

function emptyEffect(send: ArrayBuffer | null = null): LiveAmdEffect {
  return { view: null, record: false, requestNextActivity: false, closeSocket: false, send };
}

interface TurnMessage {
  type?: string;
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
  let socketOpen = false;
  let audioStartedAt: number | null = null;
  let lastDecision: LiveAmdDecision = { label: 'unknown', phrase: null, confidence: 0 };
  let activityRequested = false;
  let closed = false;
  let lastEnergyAtMs: number | null = null;

  const audioMs = () => Math.round((samplesSeen / LIVE_AMD_SAMPLE_RATE) * 1000);

  const windowHadEnergy = (clock: number) => lastEnergyAtMs !== null && clock - lastEnergyAtMs <= LIVE_AMD_WINDOW_MS;

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
      if (pcmHasEnergy(pcm)) lastEnergyAtMs = audioMs();
      queue.push(pcm);
      const send = socketOpen ? queue.drain() : null;
      const decision = decide(false);
      return { ...decision, send };
    },
    onSocketOpen(): ArrayBuffer | null {
      socketOpen = true;
      return queue.drain();
    },
    onMessage(raw: string): LiveAmdEffect {
      if (closed) return emptyEffect();
      let message: TurnMessage;
      try {
        message = JSON.parse(raw) as TurnMessage;
      } catch {
        return emptyEffect();
      }
      if (message.type !== 'Turn') return emptyEffect();
      transcript.applyTurn(wordsFromTurn(message, audioMs()), message.end_of_turn === true);
      return decide(false);
    },
    onCallEnded(): LiveAmdEffect {
      if (closed) return emptyEffect();
      closed = true;
      socketOpen = false;
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
