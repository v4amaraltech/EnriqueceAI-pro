// Captura do áudio remoto para a escuta dos 15 s (live_amd).
//
// - Clona a faixa remota: o AudioContext da captura não fica na mesma instância
//   de track que o <audio> e o tap de diagnóstico. No fim, para só o clone.
// - AudioWorklet (arquivo estático em /public/worklets, porque a CSP só libera
//   script de 'self'). Se o worklet não carregar, cai para o ScriptProcessor.
// - Informa o estado do AudioContext (statechange) para a sessão só enviar à
//   AssemblyAI com o contexto em `running`. O resume() fica com o registro do
//   webphone (criação e gesto do microfone).

import type { LiveAmdAudioContextState, LiveAmdPumpKind } from './live-amd-session';
import { downsampleToPcm16 } from './live-amd-window';
import { registerWebphoneAudioContext } from './webphone-audio-contexts';

export const LIVE_AMD_WORKLET_URL = '/worklets/live-amd-capture.js';
export const LIVE_AMD_WORKLET_NAME = 'live-amd-capture';
const SCRIPT_PROCESSOR_BUFFER = 4096;

export interface AudioPumpHooks {
  onInfo?(info: { pump: LiveAmdPumpKind; trackCloned: boolean | null }): void;
  onContextState?(state: LiveAmdAudioContextState): void;
}

export interface AudioPump {
  start(onPcm: (pcm: Int16Array) => void, hooks?: AudioPumpHooks): () => void;
}

/** Faixa mínima que a captura usa. */
export interface CaptureTrack {
  clone?: () => CaptureTrack;
  stop(): void;
}

interface CaptureNode {
  connect(target: unknown): unknown;
  disconnect(): void;
}

interface CaptureWorkletNode extends CaptureNode {
  port: { onmessage: ((event: { data: unknown }) => void) | null };
}

interface CaptureScriptProcessor extends CaptureNode {
  onaudioprocess: ((event: { inputBuffer: { sampleRate: number; getChannelData(channel: number): Float32Array } }) => void) | null;
}

/** Subconjunto do AudioContext usado aqui (injetável nos testes). */
export interface CaptureAudioContext {
  readonly state: string;
  readonly sampleRate: number;
  readonly destination: unknown;
  audioWorklet?: { addModule(url: string): Promise<void> };
  resume(): Promise<void>;
  close(): Promise<void>;
  createMediaStreamSource(stream: unknown): CaptureNode;
  createGain(): CaptureNode & { gain: { value: number } };
  createScriptProcessor(bufferSize: number, inputs: number, outputs: number): CaptureScriptProcessor;
  addEventListener?(type: 'statechange', listener: () => void): void;
  removeEventListener?(type: 'statechange', listener: () => void): void;
}

export interface CaptureEnv {
  createContext(): CaptureAudioContext;
  createStream(track: CaptureTrack): unknown;
  createWorkletNode(ctx: CaptureAudioContext, name: string): CaptureWorkletNode;
  workletUrl: string;
}

export function normalizeContextState(state: string | undefined): LiveAmdAudioContextState {
  return state === 'running' || state === 'suspended' || state === 'closed' || state === 'interrupted' ? state : 'unknown';
}

function browserCaptureEnv(): CaptureEnv | null {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return null;
  return {
    createContext: () => new window.AudioContext() as unknown as CaptureAudioContext,
    createStream: (track) => new MediaStream([track as unknown as MediaStreamTrack]),
    createWorkletNode: (ctx, name) => {
      if (typeof window.AudioWorkletNode === 'undefined') throw new Error('AudioWorkletNode indisponível');
      return new window.AudioWorkletNode(ctx as unknown as BaseAudioContext, name) as unknown as CaptureWorkletNode;
    },
    workletUrl: LIVE_AMD_WORKLET_URL,
  };
}

/** Clona a faixa. Sem clone(), usa a original (e não a para no fim). */
function cloneTrack(track: CaptureTrack): { tap: CaptureTrack; cloned: boolean } {
  if (typeof track.clone !== 'function') return { tap: track, cloned: false };
  try {
    return { tap: track.clone(), cloned: true };
  } catch {
    return { tap: track, cloned: false };
  }
}

export function createCapturePump(track: CaptureTrack, env: CaptureEnv | null = browserCaptureEnv()): AudioPump {
  return {
    start(onPcm, hooks = {}) {
      if (!env) {
        hooks.onInfo?.({ pump: 'none', trackCloned: null });
        return () => undefined;
      }
      const { tap, cloned } = cloneTrack(track);
      const ctx = env.createContext();
      const unregister = registerWebphoneAudioContext(ctx);
      let stopped = false;
      let teardownNode: () => void = () => undefined;

      const reportState = () => {
        if (!stopped) hooks.onContextState?.(normalizeContextState(ctx.state));
      };
      ctx.addEventListener?.('statechange', reportState);
      reportState();

      const source = ctx.createMediaStreamSource(env.createStream(tap));
      // Saída muda: o nó precisa estar ligado ao destino para processar, sem tocar o áudio duas vezes.
      const silent = ctx.createGain();
      silent.gain.value = 0;
      silent.connect(ctx.destination);

      const deliver = (samples: Float32Array, sampleRate: number) => {
        if (!stopped) onPcm(downsampleToPcm16(samples, sampleRate));
      };

      const useScriptProcessor = () => {
        const processor = ctx.createScriptProcessor(SCRIPT_PROCESSOR_BUFFER, 1, 1);
        processor.onaudioprocess = (event) => {
          deliver(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
        };
        source.connect(processor);
        processor.connect(silent);
        teardownNode = () => {
          processor.onaudioprocess = null;
          processor.disconnect();
        };
        hooks.onInfo?.({ pump: 'script_processor', trackCloned: cloned });
      };

      void (async () => {
        try {
          if (!ctx.audioWorklet) throw new Error('AudioWorklet indisponível');
          await ctx.audioWorklet.addModule(env.workletUrl);
          if (stopped) return;
          const node = env.createWorkletNode(ctx, LIVE_AMD_WORKLET_NAME);
          node.port.onmessage = (event) => {
            if (event.data instanceof Float32Array) deliver(event.data, ctx.sampleRate);
          };
          source.connect(node);
          node.connect(silent);
          teardownNode = () => {
            node.port.onmessage = null;
            node.disconnect();
          };
          hooks.onInfo?.({ pump: 'worklet', trackCloned: cloned });
        } catch (err) {
          if (stopped) return;
          console.warn('[webphone-live-amd] worklet indisponível, usando ScriptProcessor:', err);
          try {
            useScriptProcessor();
          } catch (fallbackErr) {
            console.error('[webphone-live-amd] captura sem processador:', fallbackErr);
            hooks.onInfo?.({ pump: 'none', trackCloned: cloned });
          }
        }
      })();

      return () => {
        if (stopped) return;
        stopped = true;
        ctx.removeEventListener?.('statechange', reportState);
        teardownNode();
        source.disconnect();
        silent.disconnect();
        unregister();
        // Para só o clone: a faixa original segue no <audio> do SDR.
        if (cloned) tap.stop();
        void Promise.resolve(ctx.close()).catch(() => undefined);
      };
    },
  };
}
