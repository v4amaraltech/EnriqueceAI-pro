import { describe, expect, it } from 'vitest';

import {
  classifyGmailSendResult, classifyInbound, extractEmailAddress, extractPlainText, headersToMap, stripQuotedReply,
} from './inbound-classifier';

const own = ['ana.ia1@v4.com.br', 'ana.ia2@v4.com.br'];

describe('classifyInbound', () => {
  it('mensagem da própria caixa (ou irmã) é own', () => {
    expect(classifyInbound({ headers: { from: 'Ana <Ana.IA2@v4.com.br>' }, ownEmails: own })).toBe('own');
  });
  it('bounce por remetente ou multipart/report', () => {
    expect(classifyInbound({ headers: { from: 'Mail Delivery Subsystem <mailer-daemon@googlemail.com>' }, ownEmails: own })).toBe('bounce');
    expect(classifyInbound({ headers: { from: 'x@y.com' }, ownEmails: own, mimeType: 'multipart/report' })).toBe('bounce');
  });
  it('auto-reply por cabeçalho ou assunto; Auto-Submitted: no não conta', () => {
    expect(classifyInbound({ headers: { from: 'j@ind.com', 'auto-submitted': 'auto-replied' }, ownEmails: own })).toBe('auto_reply');
    expect(classifyInbound({ headers: { from: 'j@ind.com', subject: 'Resposta automática: ausência' }, ownEmails: own })).toBe('auto_reply');
    expect(classifyInbound({ headers: { from: 'j@ind.com', 'auto-submitted': 'no', subject: 'Re: proposta' }, ownEmails: own })).toBe('lead');
  });
  it('resposta normal do lead é lead; sem From é unknown', () => {
    expect(classifyInbound({ headers: { from: 'João <joao@arrozx.com.br>', subject: 'Re: V4' }, ownEmails: own })).toBe('lead');
    expect(classifyInbound({ headers: {}, ownEmails: own })).toBe('unknown');
  });
});

describe('helpers', () => {
  it('extractEmailAddress e headersToMap', () => {
    expect(extractEmailAddress('Nome <A@B.com>')).toBe('a@b.com');
    expect(extractEmailAddress('sem-email')).toBeNull();
    expect(headersToMap([{ name: 'From', value: 'x' }, { name: 'Subject', value: 'y' }])).toEqual({ from: 'x', subject: 'y' });
  });
  it('extractPlainText prefere text/plain e limpa html', () => {
    const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(extractPlainText({ mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/html', body: { data: b64('<p>Oi <b>Ana</b></p>') } },
      { mimeType: 'text/plain', body: { data: b64('Oi Ana') } },
    ] })).toBe('Oi Ana');
    expect(extractPlainText({ mimeType: 'text/html', body: { data: b64('<p>Oi</p><br>Tudo bem?') } })).toBe('Oi\n\nTudo bem?');
  });
  it('stripQuotedReply corta a citação', () => {
    expect(stripQuotedReply('Pode ser terça.\n\nEm seg., 21 de set. de 2026, Ana escreveu:\n> texto')).toBe('Pode ser terça.');
  });
});

describe('classifyGmailSendResult', () => {
  it('sucesso → enviada', () => {
    expect(classifyGmailSendResult({ success: true })).toBe('enviada');
  });
  it('rejeição comprovada antes do aceite (4xx na resposta) → falhou', () => {
    expect(classifyGmailSendResult({ success: false, httpStatus: 400, stage: 'response' })).toBe('falhou');
    expect(classifyGmailSendResult({ success: false, httpStatus: 403, stage: 'response' })).toBe('falhou');
  });
  it('5xx, timeout e rede → incerta (pode ter saído; nunca reenviar sozinho)', () => {
    expect(classifyGmailSendResult({ success: false, httpStatus: 504, stage: 'response' })).toBe('incerta');
    expect(classifyGmailSendResult({ success: false, httpStatus: 503, stage: 'response' })).toBe('incerta');
    expect(classifyGmailSendResult({ success: false, stage: 'network', error: 'ETIMEDOUT' })).toBe('incerta');
    expect(classifyGmailSendResult({ success: false, error: 'sem detalhes' })).toBe('incerta');
  });
});
