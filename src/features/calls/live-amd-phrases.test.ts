import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyLiveAmd, LIVE_AMD_LISTEN_MS, normalizeLiveAmdText } from './live-amd-phrases';

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
    expect(classifyLiveAmd({ transcript: 'Este telefone está fora de área.' }).phrase).toBe('fora de area');
  });

  it('guarda a frase mais específica quando há mais de um trecho', () => {
    const decision = classifyLiveAmd({
      transcript: 'Encaminhada para a caixa postal. Grave a sua mensagem após o sinal.',
    });
    expect(decision.label).toBe('voicemail');
    expect(decision.phrase).toBe('encaminhada para a caixa postal');
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
