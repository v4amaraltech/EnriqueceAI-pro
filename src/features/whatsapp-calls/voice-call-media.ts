'use client';

// Boundary ISOLADA da perna de mídia (Epic 7 / story 7.5).
//
// O que existe hoje: captura de microfone (UX de permissão real). O handshake
// WebRTC completo depende do contrato do microserviço de voz (7.1) e está
// marcado como TODO abaixo — quando o 7.1 existir, SÓ este arquivo muda.

export async function acquireMic(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microfone indisponível neste dispositivo');
  }
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export function releaseMic(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

// TODO(7.1): completar o handshake quando o microserviço expuser o contrato real:
//   1. const pc = new RTCPeerConnection({ iceServers, NAT 1:1 conforme 7.1 })
//   2. stream.getTracks().forEach((t) => pc.addTrack(t, stream))
//   3. const offer = await pc.createOffer(); await pc.setLocalDescription(offer)
//   4. trocar SDP via Server Action (POST /api/sessions/{sid}/calls/{id}/webrtc)
//      e await pc.setRemoteDescription(answer); tratar ICE (host/trickle)
//   5. assinar o SSE same-origin (/api/whatsapp-calls/events?sid=...) e despachar
//      ANSWERED/HANGUP/SERVICE_ERROR na state machine (substitui o "Atendeu" manual).
