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
    for (let second = 0; second < 20; second++) expect(session.onPcm(seconds(second)).send).toBeNull();
    session.onSocketOpen();
    const flushed = session.onMessage(JSON.stringify({ type: 'Begin', id: 's1' })).send;
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

  it('áudio com energia e texto vazio não vira não atendido', () => {
    const session = createLiveAmdSession(() => 5_000);
    const loud = new Int16Array(16_000).fill(8_000);
    let sawNoAnswer = false;
    for (let second = 0; second < 16; second++) {
      const effect = session.onPcm(loud);
      if (effect.view?.prediction === 'no_answer') sawNoAnswer = true;
    }
    expect(sawNoAnswer).toBe(false);
    expect(session.onCallEnded().view?.prediction).toBe('unknown');
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

const BEGIN = JSON.stringify({ type: 'Begin', id: 'sessao', expires_at: 0 });
const loudSecond = () => new Int16Array(16_000).fill(8_000);

describe('envio só depois do Begin', () => {
  it('socket aberto sem Begin não envia; o Begin entrega a fila e libera o resto', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    expect(session.onPcm(seconds(1)).send).toBeNull();
    expect(session.onPcm(seconds(2)).send).toBeNull();
    const begin = session.onMessage(BEGIN);
    expect(new Int16Array(begin.send as ArrayBuffer).length).toBe(32_000);
    expect(begin.view).toBeNull();
    expect(new Int16Array(session.onPcm(seconds(3)).send as ArrayBuffer)[0]).toBe(3);
    expect(session.telemetry().beginReceived).toBe(true);
  });

  it('contexto suspenso segura o envio mesmo com Begin e solta ao voltar a rodar', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onAudioContextState('suspended');
    session.onSocketOpen();
    expect(session.onMessage(BEGIN).send).toBeNull();
    expect(session.onPcm(seconds(4)).send).toBeNull();
    const woke = session.onAudioContextState('running');
    expect(new Int16Array(woke.send as ArrayBuffer)[0]).toBe(4);
    expect(session.telemetry().audioContextState).toBe('running');
  });

  it('conta mensagens e Turns; mensagem que não é Turn não vira texto', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    session.onMessage(BEGIN);
    session.onPcm(seconds(1, 8_000));
    session.onMessage(JSON.stringify({ type: 'Termination', transcript: 'alô quem fala' }));
    session.onMessage(JSON.stringify({ type: 'Turn', end_of_turn: false, transcript: '' }));
    session.onMessage(JSON.stringify({ type: 'Turn', end_of_turn: true, transcript: 'bom dia', words: [{ text: 'bom', end: 100 }, { text: 'dia', end: 300 }] }));
    session.onMessage('não é json');
    const t = session.telemetry();
    expect(t.messageCount).toBe(4);
    expect(t.turnCount).toBe(2);
    expect(t.emptyReason).toBeNull();
    expect(session.onCallEnded().view?.transcript).toBe('bom dia');
  });

  it('fim sem texto e sem energia: silent_input', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    session.onMessage(BEGIN);
    for (let i = 0; i < 3; i++) session.onPcm(seconds(0));
    const ended = session.onCallEnded();
    // Regra da previsão não muda: silêncio no fim continua no_answer.
    expect(ended.view?.prediction).toBe('no_answer');
    const t = session.telemetry();
    expect(t.emptyReason).toBe('silent_input');
    expect(t.frames).toBe(3);
    expect(t.rmsPeak).toBe(0);
  });

  it('fim sem texto, com energia e socket aberto sem Begin: no_begin', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    for (let i = 0; i < 3; i++) session.onPcm(loudSecond());
    session.onCallEnded();
    const t = session.telemetry();
    expect(t.emptyReason).toBe('no_begin');
    expect(t.beginReceived).toBe(false);
    expect(t.rmsAvg).toBeGreaterThan(0.2);
    expect(t.rmsPeak).toBeLessThanOrEqual(1);
  });

  it('erro ou fechamento antecipado do socket: ws_error; depois do fim não conta', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    session.onPcm(loudSecond());
    session.onSocketError();
    session.onCallEnded();
    expect(session.telemetry().emptyReason).toBe('ws_error');
    expect(session.telemetry().wsError).toBe(true);

    const clean = createLiveAmdSession(() => 1_000);
    clean.onSocketOpen();
    clean.onMessage(BEGIN);
    clean.onPcm(loudSecond());
    clean.onCallEnded();
    clean.onSocketError();
    expect(clean.telemetry().wsError).toBe(false);
    expect(clean.telemetry().emptyReason).toBe('no_speech');
  });

  it('contexto que nunca rodou: context_suspended; socket que nunca abriu: no_socket', () => {
    const suspended = createLiveAmdSession(() => 1_000);
    suspended.onAudioContextState('suspended');
    suspended.onCallEnded();
    expect(suspended.telemetry().emptyReason).toBe('context_suspended');

    const noSocket = createLiveAmdSession(() => 1_000);
    noSocket.onPcm(loudSecond());
    noSocket.onCallEnded();
    expect(noSocket.telemetry().emptyReason).toBe('no_socket');
  });

  it('mensagem de erro da AssemblyAI marca ws_error', () => {
    const session = createLiveAmdSession(() => 1_000);
    session.onSocketOpen();
    session.onMessage(JSON.stringify({ error: 'sessão expirou' }));
    expect(session.telemetry().wsError).toBe(true);
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

  it('a CSP libera o WebSocket de streaming da AssemblyAI e o worklet é servido de self', () => {
    const config = readFileSync(resolve(process.cwd(), 'next.config.ts'), 'utf8');
    const connect = config.split('\n').find((line) => line.includes('connect-src')) ?? '';
    expect(connect).toContain('wss://streaming.assemblyai.com');
    expect(connect).toContain('wss://streaming.eu.assemblyai.com');
    expect(connect).toContain('wss://streaming.us.assemblyai.com');
    const worklet = readFileSync(resolve(process.cwd(), 'public/worklets/live-amd-capture.js'), 'utf8');
    expect(worklet).toContain("registerProcessor('live-amd-capture'");
  });

  it('o navegador não conhece a chave permanente', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/integrations/webphone/live-amd-browser.ts'), 'utf8');
    expect(source).not.toContain('ASSEMBLYAI_API_KEY');
    expect(source).not.toContain('OPENROUTER_API_KEY');
    expect(vi.isMockFunction(fetch)).toBe(false);
  });
});
