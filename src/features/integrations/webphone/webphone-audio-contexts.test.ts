import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  registerWebphoneAudioContext,
  resetWebphoneAudioContextsForTests,
  resumeWebphoneAudioContexts,
  webphoneAudioContextCount,
} from './webphone-audio-contexts';

function ctx(state = 'suspended', resume: () => Promise<void> = () => Promise.resolve()) {
  return { state, resume: vi.fn(resume) };
}

afterEach(() => resetWebphoneAudioContextsForTests());

describe('registro dos AudioContext do webphone', () => {
  it('registrar já tenta o resume() e a função devolvida retira do registro', () => {
    const a = ctx();
    const unregister = registerWebphoneAudioContext(a);
    expect(a.resume).toHaveBeenCalledTimes(1);
    expect(webphoneAudioContextCount()).toBe(1);
    unregister();
    expect(webphoneAudioContextCount()).toBe(0);
    resumeWebphoneAudioContexts();
    expect(a.resume).toHaveBeenCalledTimes(1);
  });

  it('resumeWebphoneAudioContexts chama resume() nos suspensos e pula os já rodando ou fechados', () => {
    const suspended = ctx('suspended');
    const running = ctx('running');
    const closed = ctx('closed');
    for (const c of [suspended, running, closed]) registerWebphoneAudioContext(c);
    suspended.resume.mockClear();
    resumeWebphoneAudioContexts();
    expect(suspended.resume).toHaveBeenCalledTimes(1);
    expect(running.resume).not.toHaveBeenCalled();
    expect(closed.resume).not.toHaveBeenCalled();
  });

  it('resume() que rejeita (sem gesto) ou lança não quebra o fluxo', async () => {
    const rejects = ctx('suspended', () => Promise.reject(new Error('NotAllowedError')));
    const throws = ctx('suspended', () => {
      throw new Error('sync');
    });
    expect(() => registerWebphoneAudioContext(rejects)).not.toThrow();
    expect(() => registerWebphoneAudioContext(throws)).not.toThrow();
    expect(() => resumeWebphoneAudioContexts()).not.toThrow();
    await Promise.resolve();
    expect(rejects.resume).toHaveBeenCalledTimes(2);
    expect(throws.resume).toHaveBeenCalledTimes(2);
  });
});
