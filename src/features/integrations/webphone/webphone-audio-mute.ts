/** Sessão SIP com mute de áudio local (JsSIP: `session.mute({ audio: true })`). */
export interface SessionAudioMute {
  isMuted: () => { audio?: boolean };
  mute: (options: { audio: boolean }) => void;
  unmute: (options: { audio: boolean }) => void;
}

/**
 * Liga ou desliga a faixa de áudio que esta aba envia na sessão ativa.
 * O JsSIP aplica isso em `RTCRtpSender.track.enabled` — o outro lado deixa
 * de receber o microfone, sem encerrar a chamada.
 */
export function toggleSessionAudio(session: SessionAudioMute): void {
  if (session.isMuted().audio) {
    session.unmute({ audio: true });
    return;
  }
  session.mute({ audio: true });
}
