import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LIVE_AMD_SPEECH_MODEL, assemblyAiHosts, assemblyAiWebsocketUrl } from './assemblyai-streaming';
import { createLiveAmdSession } from './live-amd-session';
import { downsampleToPcm16 } from './live-amd-window';
import { LIVE_AMD_LGPD_NOTICE } from '@/features/calls/live-amd-notice';

function seconds(value: number, count = 16_000): Int16Array {
  return new Int16Array(count).fill(value);
}

describe('janela dos últimos 15 segundos', () => {
  it('descarta o áudio que saiu da janela e só entrega os 15 segundos mais recentes', () => {
    let now = 1_000;
    const session = createLiveAmdSession(() => now);
    for (let second = 0; second < 20; second++) session.onPcm(seconds(second));
    const flushed = session.onSocketOpen();
    expect(flushed).not.toBeNull();
    const sent = new Int16Array(flushed as ArrayBuffer);
    expect(sent.length).toBe(16_000 * 15);
    expect(sent[0]).toBe(5);
    expect(sent[sent.length - 1]).toBe(19);

    now = 4_000;
    const live = session.onPcm(seconds(20));
    const followed = new Int16Array(live.send as ArrayBuffer);
    expect(followed.length).toBe(16_000);
    expect(followed[0]).toBe(20);
  });

  it('a frase que já saiu dos últimos 15 segundos não vira a classe', () => {
    const session = createLiveAmdSession(() => 10_000);
    let silence: ReturnType<typeof session.onPcm> | null = null;
    for (let second = 0; second < 20; second++) {
      const effect = session.onPcm(seconds(1));
      if (effect.view) silence = effect;
    }
    expect(silence?.view?.prediction).toBe('no_answer');
    expect(silence?.requestNextActivity).toBe(true);
    expect(silence?.closeSocket).toBe(false);
    session.onSocketOpen();
    const late = session.onMessage(
      JSON.stringify({
        type: 'Turn',
        end_of_turn: true,
        transcript: 'sua chamada esta sendo encaminhada para a caixa de mensagens',
        words: [{ text: 'caixa postal', end: 1_000 }],
      }),
    );
    expect(late.view?.prediction).not.toBe('voicemail');
    expect(late.requestNextActivity).toBe(false);
  });

  it('classifica a fala recente e continua a escuta', () => {
    const session = createLiveAmdSession(() => 2_000);
    session.onPcm(seconds(1, 8_000));
    const effect = session.onMessage(
      JSON.stringify({
        type: 'Turn',
        end_of_turn: false,
        transcript: 'Alô, quem fala?',
        words: [
          { text: 'Alô', end: 200 },
          { text: 'quem', end: 400 },
          { text: 'fala', end: 600 },
        ],
      }),
    );
    expect(effect.view?.prediction).toBe('human');
    expect(effect.requestNextActivity).toBe(false);
    expect(effect.closeSocket).toBe(false);
    expect(session.onCallEnded().requestNextActivity).toBe(true);
  });

  it('reduz 32 kHz para PCM 16 kHz', () => {
    const input = new Float32Array([0.5, 0.5, -1, -1]);
    const pcm = downsampleToPcm16(input, 32_000);
    expect(pcm.length).toBe(2);
    expect(pcm[0]).toBeGreaterThan(16_000);
    expect(pcm[1]).toBeLessThan(0);
  });
});

describe('endereço do streaming', () => {
  it('usa o modelo multilíngue com português e PCM 16 kHz, com região opcional', () => {
    const url = new URL(assemblyAiWebsocketUrl(assemblyAiHosts(undefined).streamingWs, 'token-curto'));
    expect(url.protocol).toBe('wss:');
    expect(url.hostname).toBe('streaming.assemblyai.com');
    expect(url.searchParams.get('speech_model')).toBe(LIVE_AMD_SPEECH_MODEL);
    expect(url.searchParams.get('encoding')).toBe('pcm_s16le');
    expect(url.searchParams.get('sample_rate')).toBe('16000');
    expect(url.searchParams.get('token')).toBe('token-curto');
    expect(url.searchParams.has('language_codes')).toBe(false);
    expect(assemblyAiHosts('eu').streamingWs).toBe('wss://streaming.eu.assemblyai.com');
    expect(assemblyAiHosts('eu').tokenHttp).toBe('https://token.eu.assemblyai.com');
    expect(assemblyAiHosts('us').streamingWs).toBe('wss://streaming.us.assemblyai.com');
  });

  it('o aviso cobre a ligação inteira e os últimos 15 segundos', () => {
    expect(LIVE_AMD_LGPD_NOTICE).toContain('últimos 15 segundos');
    expect(LIVE_AMD_LGPD_NOTICE).toContain('AssemblyAI');
    expect(LIVE_AMD_LGPD_NOTICE).toContain('modelo de linguagem');
    expect(LIVE_AMD_LGPD_NOTICE.toLowerCase()).not.toContain('primeiros 15');
  });

  it('o navegador não conhece a chave permanente', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/integrations/webphone/live-amd-browser.ts'), 'utf8');
    expect(source).not.toContain('ASSEMBLYAI_API_KEY');
    expect(source).not.toContain('OPENROUTER_API_KEY');
    expect(vi.isMockFunction(fetch)).toBe(false);
  });
});
