import { describe, expect, it } from 'vitest';

import { measureAudioSeconds } from './audio-duration';

/** MP3 sintético: frames MPEG1 Layer III 128 kbps 44,1 kHz (417 bytes, 1152 amostras cada). */
function silentMp3(frames: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

describe('measureAudioSeconds', () => {
  it('mede a duração de um MP3 pequeno', async () => {
    const seconds = await measureAudioSeconds(silentMp3(200)); // 200 * 1152 / 44100 = 5,22 s
    expect(seconds).not.toBeNull();
    expect(seconds!).toBeGreaterThan(5);
    expect(seconds!).toBeLessThan(5.5);
  });

  it('retorna null para conteúdo que não é áudio', async () => {
    expect(await measureAudioSeconds(Buffer.from('<html>erro</html>'))).toBeNull();
  });
});
