import {
  ASSEMBLYAI_BASE_URL,
  ASSEMBLYAI_LANGUAGE,
  ASSEMBLYAI_SPEECH_MODEL,
  ASSEMBLYAI_USD_PER_AUDIO_HOUR,
} from './constants';

export interface Utterance {
  speaker: string;
  text: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface AssemblyAiResult {
  text: string;
  utterances: Utterance[];
  speakersCount: number;
  audioSeconds: number;
  model: string;
}

export interface AssemblyAiClient {
  transcribe(audio: Buffer): Promise<AssemblyAiResult>;
}

interface TranscriptResponse {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'error';
  error?: string;
  text?: string | null;
  audio_duration?: number | null;
  speech_model_used?: string | null;
  utterances?: Array<{
    speaker: string;
    text: string;
    start: number;
    end: number;
    confidence?: number;
  }> | null;
}

/** Custo estimado sobre os segundos de áudio cobrados (mono). Estéreo custaria 2x. */
export function computeAssemblyAiCostUsd(billedAudioSeconds: number): number {
  return Number(((billedAudioSeconds / 3600) * ASSEMBLYAI_USD_PER_AUDIO_HOUR).toFixed(6));
}

export class AssemblyAiError extends Error {}

interface Options {
  apiKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createAssemblyAiClient(opts: Options): AssemblyAiClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollIntervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 240_000;

  async function call<T>(url: string, init: RequestInit): Promise<T> {
    const res = await doFetch(url, {
      ...init,
      headers: { authorization: opts.apiKey, ...(init.headers as Record<string, string> | undefined) },
    });
    if (!res.ok) throw new AssemblyAiError(`assemblyai_http_${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async transcribe(audio) {
      const upload = await call<{ upload_url: string }>(`${ASSEMBLYAI_BASE_URL}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(audio),
      });
      const created = await call<TranscriptResponse>(`${ASSEMBLYAI_BASE_URL}/transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audio_url: upload.upload_url,
          speech_models: [ASSEMBLYAI_SPEECH_MODEL],
          language_code: ASSEMBLYAI_LANGUAGE,
          speaker_labels: true,
        }),
      });

      const deadline = Date.now() + timeoutMs;
      let current = created;
      while (current.status !== 'completed') {
        if (current.status === 'error') throw new AssemblyAiError(`assemblyai_error: ${current.error ?? 'unknown'}`);
        if (Date.now() > deadline) throw new AssemblyAiError('assemblyai_timeout');
        await sleep(pollMs);
        current = await call<TranscriptResponse>(`${ASSEMBLYAI_BASE_URL}/transcript/${created.id}`, { method: 'GET' });
      }

      const utterances = (current.utterances ?? []).map((u) => ({
        speaker: u.speaker,
        text: u.text,
        start: u.start,
        end: u.end,
        ...(u.confidence !== undefined ? { confidence: u.confidence } : {}),
      }));
      return {
        text: current.text ?? '',
        utterances,
        speakersCount: new Set(utterances.map((u) => u.speaker)).size,
        audioSeconds: current.audio_duration ?? 0,
        model: current.speech_model_used ?? ASSEMBLYAI_SPEECH_MODEL,
      };
    },
  };
}
