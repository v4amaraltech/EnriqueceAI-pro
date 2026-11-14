import { recordLiveAmd } from '@/features/calls/actions/record-live-amd';
import { isCarrierAutoHangupDecision } from '@/features/calls/live-amd-phrases';

import { setActiveLiveAmdStop, stopActiveLiveAmd } from './live-amd-active';
import { type AudioPump, createCapturePump } from './live-amd-pump';
import { type LiveAmdView, createLiveAmdSession } from './live-amd-session';
import { publishLiveAmdView } from './live-amd-view-store';

interface TokenResponse {
  enabled?: boolean;
  websocketUrl?: string;
  /** Flag webphone_voicemail_autohangup. Sem ela, nada é clonado nem enviado. */
  autoHangup?: boolean;
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
  /** Frase de operadora reconhecida: encerra a ligação. Chamado uma vez só. */
  onCarrierHangup?: (view: LiveAmdView) => void;
}): () => void {
  let hungUp = false;
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
    // Telemetria da captura vai junto de todo registro (o do fim da ligação inclusive).
    void recordLiveAmd({
      telemetry: session.telemetry(),
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
    if (effect.send && socket && socket.readyState === WebSocket.OPEN) {
      socket.send(effect.send);
      session.onBytesSent(effect.send.byteLength);
    }
    publish(effect.view);
    if (effect.view && !hungUp && options.onCarrierHangup && isCarrierAutoHangupDecision({
        label: effect.view.prediction,
        phrase: effect.view.phrase,
        confidence: effect.view.confidence,
      })) {
      hungUp = true;
      options.onCarrierHangup(effect.view);
    }
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
    if (stopped || !body.enabled || !body.websocketUrl || !body.autoHangup) return;

    let ws: WebSocket;
    try {
      ws = openSocket(body.websocketUrl);
    } catch (err) {
      // CSP (connect-src) ou URL inválida. Fica na telemetria como ws_error.
      console.error('[webphone-live-amd] socket não abriu:', err);
      session.onSocketError();
      return;
    }
    socket = ws;
    ws.binaryType = 'arraybuffer';
    // O open não libera o envio: o áudio fica na fila até o Begin.
    ws.addEventListener('open', () => session.onSocketOpen());
    ws.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      apply(session.onMessage(event.data));
    });
    ws.addEventListener('error', () => session.onSocketError());
    ws.addEventListener('close', () => {
      // Fechamento antes do fim da ligação conta como ws_error (a sessão ignora depois do fim).
      session.onSocketError();
      if (socket === ws) socket = null;
    });

    const pump = options.pump ?? ((track: MediaStreamTrack) => createCapturePump(track));
    stopPump = pump(options.track).start((pcm) => apply(session.onPcm(pcm)), {
      onInfo: (info) => session.onPumpInfo(info),
      onContextState: (state) => apply(session.onAudioContextState(state)),
    });
  })();

  const stopSession = () => {
    if (stopped) return;
    stopped = true;
    setActiveLiveAmdStop(null);
    stopPump();
    apply(session.onCallEnded());
  };

  // Uma escuta anterior (ligação que não chegou a emitir ended) não pode ficar
  // segurando o clone da faixa desta aba.
  stopActiveLiveAmd();
  setActiveLiveAmdStop(stopSession);

  return stopSession;
}
