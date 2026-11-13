import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createRemoteAudioLog,
  shouldTapRemoteAudio,
  timeDomainHasSignal,
  watchRemoteAudio,
  watchRemoteTrack,
} from './remote-audio-log';
import { resetWebphoneAudioContextsForTests, webphoneAudioContextCount } from './webphone-audio-contexts';

function silence(length = 8): Uint8Array {
  return new Uint8Array(length).fill(128);
}

function tone(length = 8): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i++) bytes[i] = i % 2 === 0 ? 200 : 40;
  return bytes;
}

describe('remote audio log', () => {
  it('silêncio não conta como chegada; o primeiro quadro audível marca o tempo', () => {
    expect(timeDomainHasSignal(silence())).toBe(false);
    expect(timeDomainHasSignal(tone())).toBe(true);
    const log = createRemoteAudioLog('wp-1', 1_000);
    expect(log.noteSignal(1_100, false).firstFrameAt).toBeNull();
    const heard = log.noteSignal(1_400, true);
    expect(heard).toMatchObject({ firstFrameAt: 1_400, frames: 1, msToFirstFrame: 400 });
    expect(log.noteSignal(1_800, true).frames).toBe(2);
  });

  it('só observa a faixa de áudio quando o piloto está ligado', () => {
    expect(shouldTapRemoteAudio(true, 'audio')).toBe(true);
    expect(shouldTapRemoteAudio(false, 'audio')).toBe(false);
    expect(shouldTapRemoteAudio(undefined, 'audio')).toBe(false);
    expect(shouldTapRemoteAudio(true, 'video')).toBe(false);
  });

  it('registra chegada e encerramento no callback local, sem rede', () => {
    const frames = [silence(), tone(), tone()];
    let step = 0;
    const pending: Array<() => void> = [];
    const reports: Array<{ event: string; ms: number | null; frames: number }> = [];
    const stop = watchRemoteAudio({
      callId: 'wp-2',
      startedAt: 5_000,
      sampler: { read: () => frames[Math.min(step, frames.length - 1)] ?? silence() },
      now: () => 5_000 + step * 100,
      schedule: (tick) => {
        pending.push(tick);
        return pending.length;
      },
      cancel: () => undefined,
      report: (event, snapshot) => reports.push({ event, ms: snapshot.msToFirstFrame, frames: snapshot.frames }),
    });

    expect(reports).toEqual([]);
    pending.shift()?.();
    step = 1;
    pending.shift()?.();
    step = 2;
    pending.shift()?.();
    expect(reports).toEqual([{ event: 'chegou', ms: 100, frames: 1 }]);
    stop();
    expect(reports[1]).toEqual({ event: 'encerrou', frames: 2, ms: 100 });
    expect(pending).toHaveLength(1);
    pending.shift()?.();
    expect(reports).toHaveLength(2);

    const source = readFileSync(resolve(process.cwd(), 'src/features/integrations/webphone/remote-audio-log.ts'), 'utf8');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/WebSocket|assemblyai|wss:\/\//i);
    expect(vi.isMockFunction(fetch)).toBe(false);
  });
});

describe('watchRemoteTrack e o registro de AudioContext', () => {
  it('registra o contexto, tenta o resume() na criação e retira do registro ao parar', () => {
    resetWebphoneAudioContextsForTests();
    const node = () => ({ connect: vi.fn(), disconnect: vi.fn() });
    const contexts: Array<{ resume: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }> = [];
    class FakeAudioContext {
      state = 'suspended';
      destination = {};
      resume = vi.fn(() => Promise.resolve());
      close = vi.fn(() => Promise.resolve());
      constructor() {
        contexts.push(this);
      }
      createMediaStreamSource() {
        return node();
      }
      createAnalyser() {
        return { ...node(), fftSize: 0, getByteTimeDomainData: vi.fn() };
      }
      createGain() {
        return { ...node(), gain: { value: 1 } };
      }
    }
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('MediaStream', class {});
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);

    const stop = watchRemoteTrack({} as MediaStreamTrack, 'call-1', vi.fn());
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.resume).toHaveBeenCalledTimes(1);
    expect(webphoneAudioContextCount()).toBe(1);

    stop();
    expect(webphoneAudioContextCount()).toBe(0);
    expect(contexts[0]?.close).toHaveBeenCalledTimes(1);

    raf.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
