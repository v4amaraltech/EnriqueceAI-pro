import { afterEach, describe, expect, it, vi } from 'vitest';

import { LIVE_AMD_ACTIVITY_MODEL, parseNextActivity, suggestNextActivity } from './live-amd-next-activity';

describe('sugestão de próxima atividade', () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
  });

  it('lê o JSON do modelo', () => {
    expect(parseNextActivity('segue {"suggestion":"schedule_meeting","reason":"Aceitou amanhã às 10.","confidence":0.8}')).toEqual({
      suggestion: 'schedule_meeting',
      reason: 'Aceitou amanhã às 10.',
      confidence: 0.8,
    });
    expect(parseNextActivity('{"suggestion":"ligar"}')).toBeNull();
  });

  it('sem fala não chama a rede e sugere não conectou', async () => {
    const fetchImpl = vi.fn();
    const result = await suggestNextActivity({ transcript: '  ', prediction: 'no_answer' }, fetchImpl);
    expect(result?.suggestion).toBe('not_connected');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('pede o gpt-4.1-mini com a chave só no header', async () => {
    process.env.OPENROUTER_API_KEY = 'chave-openrouter';
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"suggestion":"schedule_callback","reason":"Pediu para ligar depois.","confidence":0.66}' } }] }), { status: 200 }),
    );
    const result = await suggestNextActivity({ transcript: 'Me liga amanhã de manhã.', prediction: 'human' }, fetchImpl);
    expect(result).toEqual({ suggestion: 'schedule_callback', reason: 'Pediu para ligar depois.', confidence: 0.66 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/chat/completions');
    expect(JSON.parse(String(init.body)).model).toBe(LIVE_AMD_ACTIVITY_MODEL);
    expect(String(init.body)).not.toContain('chave-openrouter');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer chave-openrouter');
  });

  it('sem chave configurada não sugere e não chama a rede', async () => {
    const fetchImpl = vi.fn();
    expect(await suggestNextActivity({ transcript: 'Alô, podemos marcar.', prediction: 'human' }, fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
