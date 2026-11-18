import { describe, expect, it } from 'vitest';

import { isVoicemailTranscript } from './voicemail';

describe('isVoicemailTranscript', () => {
  it.each([
    'Sua chamada está sendo encaminhada para o correio de voz e estará sujeita a cobrança após o sinal.',
    'Caixa Postal. Deixe seu recado.',
    'O número que você ligou não pode atender. Grave sua mensagem após o bipe.',
    'Por favor, grave a sua mensagem.',
    'ESTA LIGAÇÃO ESTÁ SENDO DIRECIONADA PARA A CAIXA POSTAL',
  ])('bate na regra: %s', (text) => {
    expect(isVoicemailTranscript(text)).toBe(true);
  });

  it.each([
    // Triagem de chamadas do iPhone: o lead costuma atender logo depois.
    'Olá, se você disser seu nome e o motivo da ligação, verei se esta pessoa está disponível.',
    'A pessoa que você ligou não está disponível no momento.',
    'Deixe outra mensagem após o sinal.',
    'Alô? Oi, tudo bem? Aqui é o Matheus da V4.',
    '',
  ])('não bate na regra: %s', (text) => {
    expect(isVoicemailTranscript(text)).toBe(false);
  });

  it('não bate em nulo', () => {
    expect(isVoicemailTranscript(null)).toBe(false);
    expect(isVoicemailTranscript(undefined)).toBe(false);
  });

  it('só olha os primeiros 250 caracteres', () => {
    const conversa = 'Alô, bom dia, aqui é da V4. '.repeat(10); // > 250 caracteres
    expect(conversa.length).toBeGreaterThan(250);
    expect(isVoicemailTranscript(`${conversa} eu deixei recado na caixa postal`)).toBe(false);
  });
});
