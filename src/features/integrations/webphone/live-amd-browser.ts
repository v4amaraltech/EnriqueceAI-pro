import { recordLiveAmd } from '@/features/calls/actions/record-live-amd';

import { type LiveAmdView, createLiveAmdSession } from './live-amd-session';
import { publishLiveAmdView } from './live-amd-view-store';
import { downsampleToPcm16 } from './live-amd-window';
import { registerWebphoneAudioContext } from './webphone-audio-contexts';

interface TokenResponse {
  enabled?: boolean;
  websocketUrl?: string;
}

interface AudioPump {
  start(onPcm: (pcm: Int16Array) => void): () => void;
}

/**
 * Abre o streaming só quando a rota devolve enabled. Sem flag ou sem chave,
 * não abre socket. A chave permanente não aparece neste arquivo.
 */
export function startLiveAmdBrowser(options: {
  track: MediaStreamTrack;
  callId: string;
  onView: (view: LiveAmdView) => void;
  fetchImpl?: typeof fetch;
  openSocket?: (url: string) => WebSocket;
  pump?: (track: MediaStreamTrack) => AudioPump;
}): () => void {
  let stopped = false;
  let socket: WebSocket | null = null;
  let stopPump: () => void = () => undefined;
  const session = createLiveAmdSession(() => Date.now());
  const fetchImpl = options.fetchImpl ?? fetch;
  const openSocket = options.openSocket ?? ((url: string) => new WebSocket(url));

  const publish = (view: LiveAmdView | null) => {
    if (!view) return;
    options.onView(view);
    publishLiveAmdView(options.callId, view);
  };

  const persist = (view: LiveAmdView, requestNextActivity: boolean) => {
    void recordLiveAmd({
      callId: options.callId,
      prediction: view.prediction,
      phrase: view.phrase,
      confidence: view.confidence,
      latencyMs: view.latencyMs,
      predictedAt: new Date().toISOString(),
      transcript: view.transcript,
      requestNextActivity,
    }).then((result) => {
      if (!result.success || !result.data.nextActivity) return;
      publish({
        ...view,
        nextActivity: result.data.nextActivity,
        nextActivityReason: result.data.nextActivityReason,
      });
    });
  };

  const apply = (effect: ReturnType<typeof session.onMessage>) => {
    if (effect.send && socket && socket.readyState === WebSocket.OPEN) socket.send(effect.send);
    publish(effect.view);
    if (effect.view && (effect.record || effect.requestNextActivity))
      persist(effect.view, effect.requestNextActivity);
    if (effect.closeSocket && socket) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'Terminate' }));
      socket.close();
      socket = null;
    }
  };

  void (async () => {
    let response: Response;
    try {
      response = await fetchImpl('/api/webphone/live-amd/token', { method: 'POST' });
    } catch (err) {
      console.error('[webphone-live-amd] token local falhou:', err);
      return;
    }
    if (stopped) return;
    const body = (await response.json()) as TokenResponse;
    if (!body.enabled || !body.websocketUrl) return;

    const ws = openSocket(body.websocketUrl);
    socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.addEventListener('open', () => {
      const pending = session.onSocketOpen();
      if (pending && ws.readyState === WebSocket.OPEN) ws.send(pending);
    });
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      apply(session.onMessage(event.data));
    });

    const pump = options.pump ?? defaultPump;
    stopPump = pump(options.track).start((pcm) => apply(session.onPcm(pcm)));
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    stopPump();
    apply(session.onCallEnded());
  };
}

function defaultPump(track: MediaStreamTrack): AudioPump {
  return {
    start(onPcm) {
      if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined')
        return () => undefined;
      const ctx = new window.AudioContext();
      const unregister = registerWebphoneAudioContext(ctx);
      const source = ctx.createMediaStreamSource(new MediaStream([track]));
      const processor = (
        ctx as unknown as {
          createScriptProcessor(
            bufferSize: number,
            inputs: number,
            outputs: number,
          ): AudioNode & {
            onaudioprocess: ((event: { inputBuffer: AudioBuffer }) => void) | null;
          };
        }
      ).createScriptProcessor(4096, 1, 1);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        onPcm(downsampleToPcm16(channel, event.inputBuffer.sampleRate));
      };
      source.connect(processor);
      processor.connect(silent);
      silent.connect(ctx.destination);
      return () => {
        processor.onaudioprocess = null;
        source.disconnect();
        unregister();
        void ctx.close();
      };
    },
  };
}
