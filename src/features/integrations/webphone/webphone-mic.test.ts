import { describe, expect, it, vi } from 'vitest';

import { MIC_MESSAGES, acquireMicrophonePermission, classifyMicError } from './webphone-mic';

function domError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { stream: { getTracks: () => [track] } as unknown as MediaStream, track };
}

describe('classifyMicError', () => {
  it('NotAllowedError e SecurityError são bloqueio', () => {
    expect(classifyMicError(domError('NotAllowedError'))).toBe('denied');
    expect(classifyMicError(domError('SecurityError'))).toBe('denied');
  });

  it('sem dispositivo ou dispositivo ocupado é indisponível', () => {
    for (const name of [
      'NotFoundError',
      'NotReadableError',
      'OverconstrainedError',
      'AbortError',
    ]) {
      expect(classifyMicError(domError(name))).toBe('unavailable');
    }
  });

  it('qualquer outro erro é tratado como bloqueio (conservador)', () => {
    expect(classifyMicError(domError('TypeError'))).toBe('denied');
    expect(classifyMicError('falhou')).toBe('denied');
    expect(classifyMicError(null)).toBe('denied');
  });
});

describe('acquireMicrophonePermission', () => {
  it('sucesso vira granted e para as faixas na hora', async () => {
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    await expect(acquireMicrophonePermission({ getUserMedia })).resolves.toBe('granted');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true, video: false });
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('falha devolve o estado classificado, sem lançar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      acquireMicrophonePermission({
        getUserMedia: () => Promise.reject(domError('NotAllowedError')),
      }),
    ).resolves.toBe('denied');
    await expect(
      acquireMicrophonePermission({
        getUserMedia: () => Promise.reject(domError('NotReadableError')),
      }),
    ).resolves.toBe('unavailable');
  });

  it('sem mediaDevices (contexto inseguro) é indisponível', async () => {
    await expect(acquireMicrophonePermission(undefined)).resolves.toBe('unavailable');
  });

  it('mensagens em pt-BR orientam a clicar de novo', () => {
    expect(MIC_MESSAGES.unknown).toMatch(/Ativar microfone/);
    expect(MIC_MESSAGES.denied).toMatch(/Tentar de novo/);
    expect(MIC_MESSAGES.unavailable).toMatch(/Tentar de novo/);
  });
});
