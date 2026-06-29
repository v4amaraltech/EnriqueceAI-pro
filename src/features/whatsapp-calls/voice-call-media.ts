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
