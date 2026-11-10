import { LIVE_AMD_SAMPLE_RATE, LIVE_AMD_WINDOW_MS } from './assemblyai-streaming';

export const LIVE_AMD_WINDOW_SAMPLES = Math.floor((LIVE_AMD_SAMPLE_RATE * LIVE_AMD_WINDOW_MS) / 1000);

/** Converte áudio float do navegador para PCM 16 kHz assinado. */
export function downsampleToPcm16(input: Float32Array, inputRate: number, outputRate = LIVE_AMD_SAMPLE_RATE): Int16Array {
  if (input.length === 0 || inputRate <= 0) return new Int16Array();
  const ratio = inputRate / outputRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    let count = 0;
    for (let j = start; j < end; j++) {
      sum += input[j] ?? 0;
      count += 1;
    }
    const sample = count ? Math.max(-1, Math.min(1, sum / count)) : 0;
    out[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }
  return out;
}

/**
 * Fila dos últimos 15 segundos. O que passa dessa idade sai da fila e não
 * pode mais ser enviado.
 */
export function createSlidingPcmQueue(maxSamples = LIVE_AMD_WINDOW_SAMPLES) {
  let chunks: Int16Array[] = [];
  let samples = 0;

  function trim(): void {
    while (samples > maxSamples && chunks.length > 0) {
      const first = chunks[0];
      if (!first) break;
      const overflow = samples - maxSamples;
      if (overflow >= first.length) {
        chunks.shift();
        samples -= first.length;
      } else {
        chunks[0] = first.subarray(overflow);
        samples -= overflow;
        break;
      }
    }
  }

  return {
    push(pcm: Int16Array): void {
      if (pcm.length === 0) return;
      chunks.push(pcm);
      samples += pcm.length;
      trim();
    },
    /** Tira da fila o que ainda não foi enviado. Vazio se não houver nada. */
    drain(): ArrayBuffer | null {
      if (samples === 0) return null;
      const out = new Int16Array(samples);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      chunks = [];
      samples = 0;
      return out.buffer;
    },
    get samples() {
      return samples;
    },
  };
}

export interface TranscriptWord {
  text: string;
  endMs: number;
}

/** Junta as falas finais e o parcial atual. A janela recente filtra pelo fim da palavra. */
export function createTranscriptLog() {
  let finals: TranscriptWord[] = [];
  let partial: TranscriptWord[] = [];

  const all = () => finals.concat(partial).filter((word) => word.text.trim().length > 0);

  return {
    applyTurn(words: TranscriptWord[], endOfTurn: boolean): void {
      const clean = words.filter((word) => word.text.trim().length > 0);
      if (endOfTurn) {
        finals = finals.concat(clean);
        partial = [];
      } else {
        partial = clean;
      }
    },
    textSince(fromMs: number): string {
      return all()
        .filter((word) => word.endMs >= fromMs)
        .map((word) => word.text)
        .join(' ')
        .trim();
    },
    fullText(): string {
      return all()
        .map((word) => word.text)
        .join(' ')
        .trim();
    },
  };
}
