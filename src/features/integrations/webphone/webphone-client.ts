// Cliente SIP/WebRTC do webphone no navegador (JsSIP). Singleton de módulo:
// uma instância por aba, fora do React — a UI só observa `WebphoneState`.
//
// Fluxo (story api4com-embedded-webphone, bloco 2): a página registra o ramal
// em `wss://{domínio}:6443`; o servidor origina a ligação por `POST /calls`;
// a API4COM manda o INVITE para o ramal com `X-Api4comintegratedcall: true`
// e a página atende sozinha. Sem extensão do Chrome.
import type { RTCSession } from 'jssip/lib/RTCSession';
import type { IncomingRequest, OutgoingRequest } from 'jssip/lib/SIPMessage';
import type { UA } from 'jssip/lib/UA';

import { stopActiveLiveAmd } from './live-amd-active';
import { shouldTapRemoteAudio, watchRemoteTrack } from './remote-audio-log';
import { resumeWebphoneAudioContexts } from './webphone-audio-contexts';
import { toggleSessionAudio } from './webphone-audio-mute';
import { summarizeRtcStats } from './webphone-audio-stats';
import { claimWebphoneDial } from './webphone-dial-correlation';
import { getWebphoneInstanceId, newInstanceUUID } from './webphone-instance-id';
import {
  type MicPermission,
  type MicPermissionsApi,
  acquireMicrophonePermission,
  isMicrophonePermissionGranted,
} from './webphone-mic';
import {
  INTEGRATED_CALL_HEADER,
  type WebphoneEvent,
  type WebphoneState,
  initialWebphoneState,
  isIntegratedCallHeader,
  reduceWebphone,
  remoteNumberFromUri,
  resolveMicForDial,
  webphoneMicNeedsGesture,
} from './webphone-state';
import {
  type WebphoneTabLock,
  broadcastLockBus,
  browserLockClock,
  createWebphoneTabLock,
} from './webphone-tab-lock';

export interface WebphoneSipConfig {
  sipDomain: string;
  ramal: string;
  sipPassword: string;
  /** Piloto: observa a faixa remota e só registra a chegada no console. */
  liveListen?: boolean;
}

const SIP_WSS_PORT = 6443;
const ENDED_CALL_CLEAR_MS = 2500;
// Amostra de `getStats()` a cada poucos segundos durante a conversa: quando o
// OUTRO lado desliga, a RTCPeerConnection já está fechada no evento `ended` e
// `getStats()` não responde mais — fica valendo a última amostra.
const STATS_SAMPLE_MS = 5000;
// Ao desligar daqui, esperamos no máximo isto por uma amostra final antes do BYE.
const STATS_FINAL_TIMEOUT_MS = 400;
/** Se o BYE não emitir `ended` neste prazo, a UI encerra mesmo assim. */
export const HANGUP_FORCE_END_MS = 1_000;

let state: WebphoneState = initialWebphoneState;
const listeners = new Set<() => void>();
let ua: UA | null = null;
let activeSession: RTCSession | null = null;
let activeCallId: string | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let activePeerConnection: RTCPeerConnection | null = null;
let statsTimer: number | null = null;
let callSeq = 0;
// Geração do start: um stop (ou um novo start) invalida um start ainda em
// andamento — o StrictMode do React monta/desmonta duas vezes em dev.
let startGeneration = 0;
let liveListenEnabled = false;
let stopRemoteTap: (() => void) | null = null;
let remoteTrack: MediaStreamTrack | null = null;
const remoteTrackListeners = new Set<() => void>();
// Última config recebida no start: "Usar nesta aba" e "Reconectar" registram
// de novo com ela, sem recarregar a página nem buscar a senha outra vez.
let lastConfig: WebphoneSipConfig | null = null;
// Trava entre abas (uma por ramal) e identificador volátil desta aba.
let tabLock: WebphoneTabLock | null = null;
const tabId = newInstanceUUID();
let pageHideBound = false;
let micRequest: Promise<MicPermission> | null = null;

function publishRemoteTrack(track: MediaStreamTrack | null): void {
  remoteTrack = track;
  for (const listener of remoteTrackListeners) listener();
}

/** Faixa remota atual. O piloto de escuta assina isso e não manda áudio se a flag estiver desligada. */
export function getRemoteAudioTrack(): MediaStreamTrack | null {
  return remoteTrack;
}

export function subscribeRemoteAudioTrack(listener: () => void): () => void {
  remoteTrackListeners.add(listener);
  return () => remoteTrackListeners.delete(listener);
}

function stopRemoteTapNow(): void {
  const stop = stopRemoteTap;
  stopRemoteTap = null;
  if (!stop) return;
  try {
    stop();
  } catch {
    /* ignore */
  }
}

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

/**
 * Pede o microfone. Chamar SÓ a partir de um clique do SDR (Ligar, iniciar o
 * Power Dialer, "Tentar de novo" do painel) ou no start quando a permissão já
 * é `granted` (aí não abre prompt): nunca no mount sem essa checagem. Não mexe
 * no UA, na sessão nem no registro, então pode ser repetido depois de um
 * bloqueio sem derrubar o ramal. Dois cliques seguidos compartilham o mesmo
 * pedido. No mesmo gesto acorda os AudioContext suspensos do webphone.
 */
export function requestWebphoneMicrophone(): Promise<MicPermission> {
  resumeWebphoneAudioContexts();
  if (micRequest) return micRequest;
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  micRequest = acquireMicrophonePermission(mediaDevices)
    .then((permission) => {
      dispatch({ type: 'mic', permission });
      return permission;
    })
    .finally(() => {
      micRequest = null;
    });
  return micRequest;
}

/**
 * Chamar no clique de discagem (Ligar, iniciar ou retomar o Power Dialer),
 * ANTES de armar a trava de clique duplo. Acorda os AudioContext no mesmo
 * gesto. Se o microfone ainda não foi pedido nesta aba, pede agora e devolve a
 * Promise com a mensagem para o toast (ou `null` se concedeu). Sem nada a
 * pedir devolve `null` na hora, sem Promise: o clique segue síncrono como
 * antes. Os outros bloqueios seguem com `dialingBlockReason`.
 */
export function prepareWebphoneMicForDial(): Promise<string | null> | null {
  resumeWebphoneAudioContexts();
  if (!webphoneMicNeedsGesture(state)) return null;
  return resolveMicForDial(state, requestWebphoneMicrophone);
}

function browserPermissions(): MicPermissionsApi | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator as Navigator & { permissions?: MicPermissionsApi }).permissions;
}

/**
 * No start: se o navegador já liberou o microfone para o site, libera em
 * silêncio (o `getUserMedia` não abre prompt) e o INVITE integrado volta a ser
 * atendido sem clique. Com `prompt`/`denied`/sem a API, não chama
 * `getUserMedia`: o pedido fica para o clique em Ligar.
 */
async function autoActivateMicIfGranted(generation: number): Promise<void> {
  if (state.mic === 'granted') return;
  const granted = await isMicrophonePermissionGranted(browserPermissions());
  if (!granted || generation !== startGeneration) return;
  await requestWebphoneMicrophone();
}

function ensureTabLock(ramal: string): WebphoneTabLock {
  if (tabLock && tabLock.ramal === ramal) return tabLock;
  tabLock?.dispose();
  tabLock = createWebphoneTabLock({
    ramal,
    tabId,
    bus: broadcastLockBus(),
    clock: browserLockClock,
    // Outra aba clicou em "Usar nesta aba": para o UA daqui de forma limpa
    // (sem reload) e mostra que o ramal está em uso lá.
    onLost: () => {
      stopWebphone();
      dispatch({ type: 'session_conflict', conflict: 'other_tab' });
    },
  });
  if (!pageHideBound) {
    pageHideBound = true;
    window.addEventListener('pagehide', () => tabLock?.release());
  }
  return tabLock;
}

function clearEndedCallLater(id: string): void {
  window.setTimeout(() => {
    if (activeCallId === id) {
      activeSession = null;
      activeCallId = null;
      activePeerConnection = null;
    }
    dispatch({ type: 'call_cleared', id });
  }, ENDED_CALL_CLEAR_MS);
}

/** Lê `getStats()` da conexão ativa e publica o resumo no estado. Nunca lança. */
async function sampleAudioStats(id: string): Promise<void> {
  const pc = activePeerConnection;
  if (!pc || activeCallId !== id || pc.connectionState === 'closed') return;
  try {
    const stats = summarizeRtcStats(await pc.getStats());
    if (stats && activeCallId === id) dispatch({ type: 'call_stats', id, stats });
  } catch (err) {
    console.warn('[webphone] getStats failed:', err);
  }
}

function startStatsSampling(id: string): void {
  stopStatsSampling();
  statsTimer = window.setInterval(() => void sampleAudioStats(id), STATS_SAMPLE_MS);
}

function stopStatsSampling(): void {
  if (statsTimer !== null) {
    window.clearInterval(statsTimer);
    statsTimer = null;
  }
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
  const remoteNumber = remoteNumberFromUri(session.remote_identity?.uri?.user);
  activeSession = session;
  activeCallId = id;

  dispatch({
    type: 'call_new',
    id,
    remoteNumber,
    direction: incoming ? 'incoming' : 'outgoing',
    integrated,
    dialToken: claimWebphoneDial(remoteNumber, integrated),
    at: Date.now(),
  });

  session.on('peerconnection', ({ peerconnection }) => {
    activePeerConnection = peerconnection;
    peerconnection.addEventListener('track', (ev: RTCTrackEvent) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      attachRemoteStream(stream);
      if (ev.track.kind === 'audio') publishRemoteTrack(ev.track);
      if (!shouldTapRemoteAudio(liveListenEnabled, ev.track.kind)) return;
      stopRemoteTapNow();
      stopRemoteTap = watchRemoteTrack(ev.track, id);
    });
  });
  session.on('accepted', () => dispatch({ type: 'call_accepted', id, at: Date.now() }));
  session.on('confirmed', () => {
    if (state.call?.id === id && state.call.phase === 'ringing')
      dispatch({ type: 'call_accepted', id, at: Date.now() });
    startStatsSampling(id);
  });
  session.on('muted', () => dispatch({ type: 'call_muted', id, muted: true }));
  session.on('unmuted', () => dispatch({ type: 'call_muted', id, muted: false }));
  const onEnd = (e: { cause?: string }) => {
    stopStatsSampling();
    stopRemoteTapNow();
    publishRemoteTrack(null);
    dispatch({ type: 'call_ended', id, at: Date.now(), cause: e?.cause ?? null });
    clearEndedCallLater(id);
  };
  session.on('ended', onEnd);
  session.on('failed', onEnd);

  // Chamada originada pela API (POST /calls): atende sozinha, mas só com o
  // microfone concedido (senão a perna ficaria sem áudio; o discador já
  // deveria ter sido barrado por `dialingBlockReason`). Inbound "de verdade"
  // fica tocando até o SDR clicar em Atender.
  if (integrated && state.mic === 'granted') {
    answerCall();
  }
}

/**
 * Registra o ramal. Chamar de novo com outra config derruba a instância
 * anterior (singleton). Só pede o microfone se a permissão já for `granted`
 * (sem prompt); nos outros casos o pedido fica para o clique
 * (`prepareWebphoneMicForDial` / `requestWebphoneMicrophone`). Antes do `UA.start()` consulta as outras abas;
 * se uma delas já segura o ramal, não registra e publica o conflito.
 * `takeover: true` é o "Usar nesta aba": tira o ramal da outra aba primeiro.
 */
export async function startWebphone(
  config: WebphoneSipConfig,
  options: { takeover?: boolean } = {},
): Promise<void> {
  if (typeof window === 'undefined') return;
  stopWebphone();
  lastConfig = config;
  liveListenEnabled = config.liveListen === true;
  const generation = ++startGeneration;

  const lock = ensureTabLock(config.ramal);
  if (options.takeover) {
    const ok = await lock.takeover();
    if (generation !== startGeneration || !ok) return;
  } else {
    const result = await lock.acquire();
    if (generation !== startGeneration || result === 'cancelled') return;
    if (result === 'held_elsewhere') {
      dispatch({ type: 'session_conflict', conflict: 'other_tab' });
      return;
    }
  }

  const JsSIP = await import('jssip');
  if (generation !== startGeneration) return;

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
    // UUID por navegador (`+sip.instance` no Contact); ver webphone-instance-id.ts.
    instance_id: getWebphoneInstanceId(),
  });
  ua = instance;

  // Eventos de um UA já parado (stop/remount) não mexem mais no estado: o
  // `unregistered` do nosso próprio `ua.stop()` não pode virar "perdido para
  // outra instância".
  const emit = (event: WebphoneEvent) => {
    if (ua === instance) dispatch(event);
  };
  instance.on('connecting', () => emit({ type: 'connecting' }));
  instance.on('registered', () => emit({ type: 'registered' }));
  instance.on('unregistered', () => emit({ type: 'unregistered' }));
  instance.on('disconnected', (e: { reason?: string }) =>
    emit({ type: 'disconnected', error: e.reason }),
  );
  instance.on('registrationFailed', (e: { cause?: string }) =>
    emit({ type: 'registration_failed', cause: String(e.cause ?? 'desconhecida') }),
  );
  instance.on(
    'newRTCSession',
    (e: { session: RTCSession; request: IncomingRequest | OutgoingRequest }) =>
      handleNewSession(e.session, e.request),
  );

  instance.start();
  void autoActivateMicIfGranted(generation);
}

export function stopWebphone(): void {
  startGeneration++;
  liveListenEnabled = false;
  stopActiveLiveAmd();
  tabLock?.release();
  stopRemoteTapNow();
  publishRemoteTrack(null);
  stopStatsSampling();
  activePeerConnection = null;
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

/**
 * "Usar nesta aba": tira o ramal da outra aba (ela para o UA dela, sem
 * reload) e registra aqui. Derruba a ligação que estiver na outra aba.
 */
export function takeOverWebphone(): Promise<void> {
  if (!lastConfig) return Promise.resolve();
  return startWebphone(lastConfig, { takeover: true });
}

/**
 * "Reconectar" depois que o ramal caiu sem ter sido pedido aqui (outro
 * navegador ou a extensão). Com o UA vivo, só manda um novo REGISTER; sem
 * ele, refaz o start assumindo o ramal.
 */
export function reconnectWebphone(): Promise<void> {
  if (ua && tabLock?.isHolding()) {
    try {
      ua.register();
      return Promise.resolve();
    } catch (err) {
      console.error('[webphone] re-register failed:', err);
    }
  }
  return takeOverWebphone();
}

export function answerCall(): void {
  if (!activeSession || state.call?.phase !== 'ringing') return;
  try {
    activeSession.answer({ mediaConstraints: { audio: true, video: false } });
  } catch (err) {
    console.error('[webphone] answer failed:', err);
  }
}

/**
 * Desliga a perna do ramal.
 *
 * A escuta ao vivo (clone da faixa + AudioContext) para ANTES do BYE. Se a
 * limpeza ficar só depois do `ended`, e o clone impedir o evento, Mutar e
 * Desligar ficam sem efeito e a UI permanece em "Chamando o lead".
 *
 * A amostra final de `getStats()` roda em paralelo, sem atrasar o BYE: o
 * `terminate()` fecha a RTCPeerConnection na hora, e já há amostras periódicas.
 * Se o `ended` não chegar em `HANGUP_FORCE_END_MS`, a UI encerra mesmo assim.
 */
export async function hangupCall(): Promise<void> {
  const session = activeSession;
  const call = state.call;
  if (!call || call.phase === 'ended') {
    try {
      stopActiveLiveAmd();
    } catch (err) {
      console.error('[webphone] stop live amd failed:', err);
    }
    return;
  }

  const id = call.id;

  // Agenda o encerramento da UI ANTES de parar a escuta. Se o stop travar
  // ou lançar, o Desligar ainda tira a tela de "Chamando o lead".
  window.setTimeout(() => {
    if (state.call?.id !== id || state.call?.phase === 'ended') return;
    try {
      stopActiveLiveAmd();
    } catch {
      /* ignore */
    }
    stopStatsSampling();
    stopRemoteTapNow();
    publishRemoteTrack(null);
    dispatch({ type: 'call_ended', id, at: Date.now(), cause: 'forced' });
    clearEndedCallLater(id);
    if (session) {
      try {
        session.terminate();
      } catch {
        /* sessão já encerrada */
      }
    }
  }, HANGUP_FORCE_END_MS);

  try {
    stopActiveLiveAmd();
  } catch (err) {
    console.error('[webphone] stop live amd failed:', err);
  }

  if (!session) {
    // Sem sessão SIP, não há BYE para esperar: encerra a UI na hora.
    stopStatsSampling();
    stopRemoteTapNow();
    publishRemoteTrack(null);
    dispatch({ type: 'call_ended', id, at: Date.now(), cause: 'forced' });
    clearEndedCallLater(id);
    return;
  }

  if (call.phase === 'in-call') {
    void Promise.race([
      sampleAudioStats(call.id),
      new Promise<void>((r) => window.setTimeout(r, STATS_FINAL_TIMEOUT_MS)),
    ]);
  }
  try {
    session.terminate();
  } catch (err) {
    console.error('[webphone] hangup failed:', err);
  }
}

/**
 * Muta ou reativa o microfone da chamada em curso. Só age com sessão SIP
 * `in-call`: fora disso não há faixa de saída para desligar. O evento
 * `muted`/`unmuted` do JsSIP atualiza `call.muted` no estado.
 */
export function toggleMute(): void {
  if (!activeSession || state.call?.phase !== 'in-call') return;
  try {
    toggleSessionAudio(activeSession);
  } catch (err) {
    console.error('[webphone] mute failed:', err);
  }
}
