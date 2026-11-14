import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyLiveAmd, isCarrierAutoHangupDecision, LIVE_AMD_LISTEN_MS, normalizeLiveAmdText } from './live-amd-phrases';

describe('classifyLiveAmd', () => {
  it('reconhece caixa postal mesmo com acento e pontuação', () => {
    const decision = classifyLiveAmd({
      transcript: 'Sua chamada está sendo encaminhada para a caixa de mensagens.',
      elapsedMs: 2_000,
    });
    expect(decision).toEqual({
      label: 'voicemail',
      phrase: 'sua chamada esta sendo encaminhada para a caixa de mensagens',
      confidence: 0.92,
    });
  });

  it('reconhece número que não existe', () => {
    expect(classifyLiveAmd({ transcript: 'O número chamado não existe.' })).toEqual({
      label: 'number_not_exist',
      phrase: 'o numero chamado nao existe',
      confidence: 0.92,
    });
    expect(classifyLiveAmd({ transcript: 'Não foi possível completar a sua chamada.' }).label).toBe('number_not_exist');
  });

  it('fora de área, fora do ar e fora de serviço viram no_answer (Fora de área), mesmo com "olá"', () => {
    expect(classifyLiveAmd({ transcript: 'Este telefone está fora de área.' })).toMatchObject({ label: 'no_answer', phrase: 'fora de area' });
    expect(classifyLiveAmd({ transcript: 'Olá, o número está fora de serviço ou indisponível.' })).toMatchObject({
      label: 'no_answer',
      phrase: 'fora de servico ou indisponivel',
    });
    expect(classifyLiveAmd({ transcript: 'O número fora de área ou indisponível' }).label).toBe('no_answer');
    expect(classifyLiveAmd({ transcript: 'Número fora do ar ou indisponível' }).label).toBe('no_answer');
  });

  it('só frase de operadora com confiança alta desliga sozinho', () => {
    expect(isCarrierAutoHangupDecision(classifyLiveAmd({ transcript: 'Encaminhada para a caixa postal' }))).toBe(true);
    expect(isCarrierAutoHangupDecision(classifyLiveAmd({ transcript: 'Está fora de serviço ou indisponível' }))).toBe(true);
    expect(isCarrierAutoHangupDecision(classifyLiveAmd({ transcript: 'O número chamado não existe' }))).toBe(true);
    expect(isCarrierAutoHangupDecision(classifyLiveAmd({ transcript: 'Alô, bom dia, quem fala?' }))).toBe(false);
    expect(isCarrierAutoHangupDecision(classifyLiveAmd({ transcript: '', elapsedMs: 20_000 }))).toBe(false);
  });

  it('guarda a frase mais específica quando há mais de um trecho', () => {
    const decision = classifyLiveAmd({
      transcript: 'Encaminhada para a caixa postal. Grave a sua mensagem após o sinal.',
    });
    expect(decision.label).toBe('voicemail');
    expect(decision.phrase).toBe('grave a sua mensagem apos o sinal');
  });

  it('reconhece a caixa postal real da operadora e o texto cortado', () => {
    const full = 'Vamos entregar o seu recado assim que o celular estiver disponível';
    expect(classifyLiveAmd({ transcript: full, elapsedMs: 4_000 })).toEqual({
      label: 'voicemail',
      phrase: 'vamos entregar o seu recado assim que o celular estiver disponivel',
      confidence: 0.92,
    });
    expect(classifyLiveAmd({ transcript: 'vamos entregar o seu recado assim que o' }).label).toBe('voicemail');
    expect(classifyLiveAmd({ transcript: 'entregar o seu recado' }).phrase).toBe('entregar o seu recado');
    expect(classifyLiveAmd({ transcript: 'o celular estiver DISPONÍVEL' }).phrase).toBe('o celular estiver disponivel');
    expect(classifyLiveAmd({ transcript: 'recado assim que estiver disponivel' })).toMatchObject({
      label: 'voicemail',
      phrase: 'recado disponivel',
    });
    expect(classifyLiveAmd({ transcript: 'entregar o seu recad assim que estiver disponiv' }).label).toBe('voicemail');
  });

  it('reconhece recado, cobertura e número inexistente das operadoras', () => {
    expect(classifyLiveAmd({ transcript: 'A pessoa chamada não pode atender no momento.' }).label).toBe('voicemail');
    expect(classifyLiveAmd({ transcript: 'Deixe seu recado após o sinal.' }).label).toBe('voicemail');
    expect(classifyLiveAmd({ transcript: 'Grave sua mensagem.' }).phrase).toBe('grave sua mensagem');
    expect(classifyLiveAmd({ transcript: 'O celular está desligado ou fora da área.' }).phrase).toBe('o celular esta desligado ou fora da area');
    expect(classifyLiveAmd({ transcript: 'Está fora da área de cobertura.' }).phrase).toBe('esta fora da area de cobertura');
    expect(classifyLiveAmd({ transcript: 'O número chamado não existe.' }).label).toBe('number_not_exist');
  });

  it('não trata fala de pessoa como recado de operadora', () => {
    expect(classifyLiveAmd({ transcript: 'Alô, quem fala?' }).label).toBe('human');
    expect(classifyLiveAmd({ transcript: 'Oi, pode falar, estou na rua agora.' })).toMatchObject({
      label: 'human',
      phrase: null,
    });
    expect(classifyLiveAmd({ transcript: 'Não posso atender agora, me liga mais tarde.' }).label).toBe('human');
  });

  it('silêncio só vira não atendido depois da janela de escuta', () => {
    expect(classifyLiveAmd({ transcript: '   ', elapsedMs: LIVE_AMD_LISTEN_MS - 1 }).label).toBe('unknown');
    expect(classifyLiveAmd({ transcript: '', elapsedMs: LIVE_AMD_LISTEN_MS })).toEqual({
      label: 'no_answer',
      phrase: null,
      confidence: 0.7,
    });
    expect(classifyLiveAmd({ transcript: '', elapsedMs: LIVE_AMD_LISTEN_MS, hadEnergy: true })).toEqual({
      label: 'unknown',
      phrase: null,
      confidence: 0,
    });
  });

  it('um alô curto antes da janela já é pessoa, e texto vazio sem tempo fica desconhecido', () => {
    expect(classifyLiveAmd({ transcript: 'Alô', elapsedMs: 800 }).label).toBe('human');
    expect(classifyLiveAmd({ transcript: '', elapsedMs: 0 })).toEqual({
      label: 'unknown',
      phrase: null,
      confidence: 0,
    });
  });

  it('normaliza acento sem depender de áudio ou de fornecedor', () => {
    expect(normalizeLiveAmdText('  Caixa   Postal! ')).toBe('caixa postal');
    const source = readFileSync(resolve(process.cwd(), 'src/features/calls/live-amd-phrases.ts'), 'utf8');
    expect(source).not.toMatch(/fetch\s*\(/);
    expect(source).not.toMatch(/WebSocket|assemblyai|api4com/i);
  });
});
