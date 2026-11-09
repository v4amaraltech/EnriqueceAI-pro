import { describe, expect, it, vi } from 'vitest';

import { toggleSessionAudio, type SessionAudioMute } from './webphone-audio-mute';

function fakeSession(audioMuted: boolean): SessionAudioMute {
  return {
    isMuted: () => ({ audio: audioMuted }),
    mute: vi.fn(),
    unmute: vi.fn(),
  };
}

describe('toggleSessionAudio', () => {
  it('pede mute do áudio de saída quando o microfone da sessão está aberto', () => {
    const session = fakeSession(false);
    toggleSessionAudio(session);
    expect(session.mute).toHaveBeenCalledWith({ audio: true });
    expect(session.unmute).not.toHaveBeenCalled();
  });

  it('pede unmute só do áudio quando a sessão já está silenciada', () => {
    const session = fakeSession(true);
    toggleSessionAudio(session);
    expect(session.unmute).toHaveBeenCalledWith({ audio: true });
    expect(session.mute).not.toHaveBeenCalled();
  });
});
