import { describe, expect, it } from 'vitest';

import { detectOptOutRequest, suggestOptOutActions } from './opt-out';

describe('detectOptOutRequest', () => {
  it.each([
    ['tira meu e-mail, elimina meu telefone', ['email', 'phone']],
    ['Pode apagar o meu contato, por favor.', ['list']],
    ['me apaga do seu WhatsApp', ['whatsapp']],
    ['Me tira da lista de vocês.', ['list']],
    ['quero sair da sua base', ['list']],
    ['Exclui o meu número, não liga mais.', ['phone']],
    ['remove meu email do mailing de vocês', ['email']],
    ['Quero me descadastrar disso.', ['list']],
    ['TIRA ESSE MEU EMAIL', ['email']],
  ])('pedido claro: %s', (text, channels) => {
    const s = detectOptOutRequest(text);
    expect(s.requested).toBe(true);
    expect(s.channels).toEqual(channels);
  });

  it.each([
    'Não tenho interesse, obrigado.',
    'Agora não, me liga mês que vem.',
    'Não, obrigado. Daqui uns dias me dá um abraço.',
    'Pode mandar no meu e-mail que eu vejo.',
    'Vou te passar meu telefone, anota aí.',
    'Deixa eu tirar uma dúvida sobre o contrato.',
    'Pode parar aí que eu vou sair agora, tô dirigindo.',
    'Vou apagar o número errado e anotar o certo.',
    'Me chama no WhatsApp.',
    '',
  ])('não é opt-out: %s', (text) => {
    expect(detectOptOutRequest(text)).toEqual({ requested: false, channels: [], patterns: [] });
  });

  it('textos nulos não marcam e vários textos somam canais', () => {
    expect(detectOptOutRequest(null, undefined).requested).toBe(false);
    const s = detectOptOutRequest('tira meu e-mail', 'pediu para remover o whatsapp');
    expect(s.channels).toEqual(['email', 'whatsapp']);
  });
});

describe('suggestOptOutActions', () => {
  it('só propõe, por canal, e sempre sugere parar cadências', () => {
    expect(suggestOptOutActions({ requested: false, channels: [], patterns: [] })).toEqual([]);
    const email = suggestOptOutActions({
      requested: true,
      channels: ['email'],
      patterns: ['remove_contact'],
    });
    expect(email.map((a) => [a.target, a.channel])).toEqual([
      ['email_suppressions', 'email'],
      ['cadence_enrollments', null],
    ]);
    const list = suggestOptOutActions({
      requested: true,
      channels: ['list'],
      patterns: ['leave_list'],
    });
    expect(list.map((a) => a.target)).toEqual([
      'email_suppressions',
      'contact_consent_evidence',
      'contact_consent_evidence',
      'cadence_enrollments',
    ]);
  });
});
