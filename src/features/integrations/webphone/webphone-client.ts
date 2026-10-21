// Cliente SIP/WebRTC do webphone no navegador (JsSIP). Singleton de módulo:
// uma instância por aba, fora do React — a UI só observa `WebphoneState`.
//
// Fluxo (story api4com-embedded-webphone, bloco 2): a página registra o ramal
// em `wss://{domínio}:6443`; o servidor origina a ligação por `POST /calls`;
// a API4COM manda o INVITE para o ramal com `X-Api4comintegratedcall: true`
// e a página atende sozinha. Sem extensão do Chrome.

import {
  INTEGRATED_CALL_HEADER,
  initialWebphoneState,
  isIntegratedCallHeader,
  reduceWebphone,
  remoteNumberFromUri,
  type WebphoneEvent,
  type WebphoneState,
} from './webphone-state';

export interface WebphoneSipConfig {
  sipDomain: string;
  ramal: string;
  sipPassword: string;
}

import type { RTCSession } from 'jssip/lib/RTCSession';
import type { IncomingRequest, OutgoingRequest } from 'jssip/lib/SIPMessage';
import type { UA } from 'jssip/lib/UA';

const SIP_WSS_PORT = 6443;
const ENDED_CALL_CLEAR_MS = 2500;

let state: WebphoneState = initialWebphoneState;
const listeners = new Set<() => void>();
let ua: UA | null = null;
let activeSession: RTCSession | null = null;
let activeCallId: string | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let callSeq = 0;
// Geração do start: um stop (ou um novo start) invalida um start ainda em
// andamento — o StrictMode do React monta/desmonta duas vezes em dev.
let startGeneration = 0;

function dispatch(event: WebphoneEvent): void {
  const next = reduceWebphone(state, event);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function getWebphoneState(): WebphoneState {
  return state;
}

export function subscribeWebphone(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio');
    remoteAudio.autoplay = true;
    remoteAudio.setAttribute('data-webphone-remote-audio', '');
    remoteAudio.style.display = 'none';
    document.body.appendChild(remoteAudio);
  }
  return remoteAudio;
}

function attachRemoteStream(stream: MediaStream): void {
  const el = ensureRemoteAudio();
  el.srcObject = stream;
  el.play().catch((err: unknown) => console.warn('[webphone] remote audio play failed:', err));
}

async function requestMicrophone(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    for (const t of stream.getTracks()) t.stop();
    dispatch({ type: 'mic', granted: true });
    return true;
  } catch (err) {
    console.warn('[webphone] microphone permission denied:', err);
    dispatch({ type: 'mic', granted: false });
    return false;
  }
}

function clearEndedCallLater(id: string): void {
  window.setTimeout(() => {
    if (activeCallId === id) {
      activeSession = null;
      activeCallId = null;
    }
    dispatch({ type: 'call_cleared', id });
  }, ENDED_CALL_CLEAR_MS);
}

function handleNewSession(session: RTCSession, request: IncomingRequest | OutgoingRequest): void {
  // Uma ligação por vez: a segunda recebe "ocupado".
  if (activeSession && state.call && state.call.phase !== 'ended') {
    try {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
    } catch {
      /* ignore */
    }
    return;
  }

  const id = `wp-${Date.now()}-${++callSeq}`;
  const incoming = session.direction === 'incoming';
  const integrated = incoming && isIntegratedCallHeader(request.getHeader(INTEGRATED_CALL_HEADER));
  activeSession = session;
  activeCallId = id;

  dispatch({
    type: 'call_new',
    id,
    remoteNumber: remoteNumberFromUri(session.remote_identity?.uri?.user),
    direction: incoming ? 'incoming' : 'outgoing',
    integrated,
    at: Date.now(),
  });

  session.on('peerconnection', ({ peerconnection }) => {
    peerconnection.addEventListener('track', (ev: RTCTrackEvent) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      attachRemoteStream(stream);
    });
  });
  session.on('accepted', () => dispatch({ type: 'call_accepted', id, at: Date.now() }));
  session.on('confirmed', () => {
    if (state.call?.id === id && state.call.phase === 'ringing') dispatch({ type: 'call_accepted', id, at: Date.now() });
  });
  session.on('muted', () => dispatch({ type: 'call_muted', id, muted: true }));
  session.on('unmuted', () => dispatch({ type: 'call_muted', id, muted: false }));
  const onEnd = (e: { cause?: string }) => {
    dispatch({ type: 'call_ended', id, at: Date.now(), cause: e?.cause ?? null });
    clearEndedCallLater(id);
  };
  session.on('ended', onEnd);
  session.on('failed', onEnd);

  // Chamada originada pela API (POST /calls): atende sozinha. Inbound "de
  // verdade" fica tocando até o SDR clicar em Atender.
  if (integrated && state.mic !== 'denied') {
    answerCall();
  }
}

/** Registra o ramal. Chamar de novo com outra config derruba a instância anterior (singleton). */
export async function startWebphone(config: WebphoneSipConfig): Promise<void> {
  if (typeof window === 'undefined') return;
  stopWebphone();
  const generation = ++startGeneration;

  const JsSIP = await import('jssip');
  if (generation !== startGeneration) return;
  // O pedido de microfone roda em paralelo: o registro SIP não pode esperar o
  // SDR responder ao prompt do navegador (senão "user not registered" ao ligar).
  void requestMicrophone();

  const domain = config.sipDomain.trim().toLowerCase();
  const socket = new JsSIP.WebSocketInterface(`wss://${domain}:${SIP_WSS_PORT}`);
  const instance = new JsSIP.UA({
    sockets: [socket],
    uri: `sip:${config.ramal}@${domain}`,
    password: config.sipPassword,
    realm: domain,
    register: true,
    register_expires: 600,
    no_answer_timeout: 30,
    session_timers: false,
    user_agent: 'enriqueceai-webphone',
    connection_recovery_min_interval: 2,
    connection_recovery_max_interval: 30,
  });
  ua = instance;

  instance.on('connecting', () => dispatch({ type: 'connecting' }));
  instance.on('registered', () => dispatch({ type: 'registered' }));
  instance.on('unregistered', () => dispatch({ type: 'unregistered' }));
  instance.on('disconnected', (e: { reason?: string }) => dispatch({ type: 'disconnected', error: e.reason }));
  instance.on('registrationFailed', (e: { cause?: string }) => dispatch({ type: 'registration_failed', cause: String(e.cause ?? 'desconhecida') }));
  instance.on('newRTCSession', (e: { session: RTCSession; request: IncomingRequest | OutgoingRequest }) => handleNewSession(e.session, e.request));

  instance.start();
}

export function stopWebphone(): void {
  startGeneration++;
  if (activeSession) {
    try {
      activeSession.terminate();
    } catch {
      /* ignore */
    }
    activeSession = null;
    activeCallId = null;
  }
  if (ua) {
    try {
      ua.stop();
    } catch {
      /* ignore */
    }
    ua = null;
  }
  dispatch({ type: 'disabled' });
}

export function answerCall(): void {
  if (!activeSession || state.call?.phase !== 'ringing') return;
  try {
    activeSession.answer({ mediaConstraints: { audio: true, video: false } });
  } catch (err) {
    console.error('[webphone] answer failed:', err);
  }
}

export function hangupCall(): void {
  if (!activeSession || !state.call || state.call.phase === 'ended') return;
  try {
    activeSession.terminate();
  } catch (err) {
    console.error('[webphone] hangup failed:', err);
  }
}

export function toggleMute(): void {
  if (!activeSession || state.call?.phase !== 'in-call') return;
  try {
    if (activeSession.isMuted().audio) activeSession.unmute({ audio: true });
    else activeSession.mute({ audio: true });
  } catch (err) {
    console.error('[webphone] mute failed:', err);
  }
}
