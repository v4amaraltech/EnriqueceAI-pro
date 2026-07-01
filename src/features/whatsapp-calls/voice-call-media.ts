'use client';

// Perna de MÍDIA da Ligação via WhatsApp (Epic 7 / story 7.5). Replica o
// handshake do cliente AstraCalls, mas com a API key PROTEGIDA no servidor:
//  - a troca de SDP (sinalização) passa pela Server Action `exchangeCallSdp`;
//  - o lifecycle (SSE) passa pela rota same-origin /api/whatsapp-calls/events.
// A mídia (RTP/SRTP/ICE) flui DIRETO browser ↔ serviço (NAT 1:1 + ICE-TCP).
import { exchangeCallSdp } from './actions/calls';

export async function acquireMic(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microfone indisponível neste dispositivo');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export function releaseMic(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export interface OpenCall {
  getRemoteStream: () => MediaStream | null;
  close: () => void;
}

function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') {
      resolve();
      return;
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
    // Salvaguarda: alguns browsers nunca atingem 'complete'.
    setTimeout(resolve, 3000);
  });
}

/**
 * Abre a conexão WebRTC com o serviço para uma chamada já iniciada (`callId`).
 * Sem STUN/TURN — o serviço expõe IP público via NAT 1:1.
 */
export async function openCall(opts: {
  sid: string;
  callId: string;
  micStream: MediaStream;
}): Promise<OpenCall> {
  const { sid, callId, micStream } = opts;
  const pc = new RTCPeerConnection({ iceServers: [] });

  micStream.getAudioTracks().forEach((t) => pc.addTrack(t, micStream));
  pc.addTransceiver('audio', { direction: 'recvonly' });

  let remote: MediaStream | null = null;
  pc.ontrack = (ev) => {
    if (ev.streams[0]) remote = ev.streams[0];
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);

  const result = await exchangeCallSdp({ sid, callId, sdpOffer: pc.localDescription?.sdp ?? '' });
  if (!result.success) {
    pc.close();
    throw new Error(result.error);
  }
  await pc.setRemoteDescription({ type: 'answer', sdp: result.data.sdpAnswer });

  return {
    getRemoteStream: () => remote,
    close: () => {
      try {
        pc.close();
      } catch {
        // ignore
      }
    },
  };
}

/**
 * Assina os eventos de lifecycle da chamada (SSE proxiado) e chama os handlers
 * quando ela é atendida (`connected`) ou encerrada (`call-ended`). Retorna a
 * função para cancelar a assinatura.
 */
export function subscribeCallEvents(
  callId: string,
  handlers: { onConnected?: () => void; onEnded?: (reason: string) => void },
): () => void {
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  const es = new EventSource(`/api/whatsapp-calls/events?clientId=${encodeURIComponent(clientId)}`);

  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as { type?: string; id?: string; status?: string; reason?: string };
      if (data.id !== callId) return;
      if (data.type === 'call-status' && data.status === 'connected') handlers.onConnected?.();
      else if (data.type === 'call-ended') handlers.onEnded?.(data.reason ?? '');
    } catch {
      // ignora linhas que não são JSON
    }
  };

  return () => es.close();
}

interface SessionSnapshot {
  sessions?: Array<{ id?: string; sid?: string; jid?: string | null; state?: string | null; paired?: boolean }>;
  qr?: string;
  paired?: boolean;
  /** Presente nos eventos `auth-state`/`session-qr` do AstraCalls (a qual sessão o evento pertence). */
  sessionId?: string;
}

/**
 * Assina os eventos de PAREAMENTO (SSE proxiado). O AstraCalls entrega o QR só
 * por aqui — como uma string crua `wa.me/...` em `{ qr }` (sem o sid) — e o estado
 * pareado nos snapshots `{ sessions: [...] }`. Como o pareamento é uma ação única
 * por vez, o QR do stream é o da sessão `sid` recém-criada; o pareado é confirmado
 * pelo snapshot (onde o `sid` aparece com `paired: true`). Retorna o unsubscribe.
 *
 * `sid` é um GETTER (não um valor) de propósito: o stream pode — e deve — ser
 * aberto ANTES de a sessão existir, para não perder o primeiro QR (o serviço faz
 * broadcast incremental do QR; se o EventSource só conecta depois do POST de
 * criação, perde-se o 1º QR e espera-se o re-broadcast do whatsmeow ~20s depois).
 * O QR (global) é entregue de imediato; `paired`/`dead` só passam a ser avaliados
 * quando o getter já retorna um `sid`.
 */
export function subscribeSessionEvents(
  getSid: () => string | null,
  handlers: { onQr?: (qr: string) => void; onPaired?: () => void; onDead?: () => void },
): () => void {
  const clientId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now());
  const es = new EventSource(`/api/whatsapp-calls/events?clientId=${encodeURIComponent(clientId)}`);

  es.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data) as SessionSnapshot;
      const sid = getSid();
      // QR: aceita SÓ o QR da nossa sessão. O AstraCalls faz broadcast global a
      // todos os assinantes (broker.broadcast); sem esse filtro, com vários SDRs
      // pareando ao mesmo tempo, um veria/escanearia o QR do outro e pareava a
      // sessão errada — a linha dele nunca conectava. Antes de termos o sid (curta
      // janela até o create resolver) aceitamos o QR global para não perder o 1º.
      if (typeof data.qr === 'string' && data.qr) {
        if (!sid || !data.sessionId || data.sessionId === sid) handlers.onQr?.(data.qr);
      }
      if (!sid) return; // ainda sem sessão criada: ignora estado de pareamento
      // Evento `auth-state` (pontual): o serviço manda `paired` no topo junto do
      // `sessionId` assim que o número conecta — confirmação direta e imediata.
      if (data.sessionId === sid && data.paired === true) handlers.onPaired?.();
      // Evento `session-list` (snapshot): acha a nossa sessão e confere o estado.
      // Pareado = `paired:true` OU state 'open' (whatsmeow conectado).
      if (Array.isArray(data.sessions)) {
        const mine = data.sessions.find((s) => (s.id ?? s.sid) === sid);
        if (mine && (mine.paired === true || mine.state === 'open')) handlers.onPaired?.();
        else if (mine && (mine.state === 'close' || mine.state === 'logged_out')) handlers.onDead?.();
      }
    } catch {
      // ignora linhas que não são JSON
    }
  };

  return () => es.close();
}
