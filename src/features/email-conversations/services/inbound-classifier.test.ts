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

import { gmailAuthenticationResults, senderAuthVerdict } from './inbound-classifier';

describe('gmailAuthenticationResults', () => {
  it('usa o cabeçalho do próprio Gmail (o primeiro mx.google.com), ignorando os de baixo', () => {
    const headers = [
      { name: 'Authentication-Results', value: 'mx.google.com; spf=fail smtp.mailfrom=lead.com; dmarc=fail header.from=lead.com' },
      // forjado pelo remetente mais abaixo
      { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=lead.com' },
    ];
    expect(gmailAuthenticationResults(headers)).toContain('dmarc=fail');
  });

  it('ignora Authentication-Results de outro servidor', () => {
    expect(gmailAuthenticationResults([{ name: 'Authentication-Results', value: 'evil.example; dmarc=pass' }])).toBeNull();
  });
});

describe('senderAuthVerdict', () => {
  const FROM = 'joao@lead.com.br';
  it.each([
    ['dmarc pass', 'mx.google.com; dkim=pass header.i=@lead.com.br; spf=fail; dmarc=pass (p=NONE) header.from=lead.com.br', 'pass'],
    ['dmarc fail vence spf pass', 'mx.google.com; spf=pass smtp.mailfrom=joao@lead.com.br; dmarc=fail header.from=lead.com.br', 'fail'],
    ['sem dmarc, spf pass do próprio domínio', 'mx.google.com; spf=pass (google.com: domain of joao@lead.com.br designates 1.2.3.4) smtp.mailfrom=joao@lead.com.br', 'pass'],
    ['sem dmarc, spf pass de subdomínio (bounce)', 'mx.google.com; spf=pass smtp.mailfrom=bounce@mail.lead.com.br', 'pass'],
    ['sem dmarc, dkim pass do próprio domínio', 'mx.google.com; dkim=pass header.i=@lead.com.br header.s=s1 header.b=abc; spf=softfail', 'pass'],
    ['sem dmarc, um dkim falho e outro aprovado alinhado', 'mx.google.com; dkim=fail header.i=@x.com; dkim=pass header.d=lead.com.br', 'pass'],
    ['FORJADO: spf/dkim aprovados mas do domínio do atacante', 'mx.google.com; dkim=pass header.i=@evil.com; spf=pass smtp.mailfrom=a@evil.com', 'fail'],
    ['FORJADO: domínio parecido não alinha', 'mx.google.com; spf=pass smtp.mailfrom=a@notlead.com.br', 'fail'],
    ['sem dmarc, tudo falhou', 'mx.google.com; dkim=none; spf=softfail smtp.mailfrom=joao@lead.com.br', 'fail'],
    ['sem cabeçalho do Gmail', null, 'unknown'],
    [
      'INJEÇÃO: "dmarc=pass" escondido no endereço de envio dentro do comentário do SPF',
      'mx.google.com; spf=pass (google.com: domain of "x;dmarc=pass"@evil.com designates 1.2.3.4 as permitted sender) smtp.mailfrom="x;dmarc=pass"@evil.com; dmarc=fail (p=NONE) header.from=lead.com.br',
      'fail',
    ],
    ['dmarc pass de OUTRO domínio (header.from) não vale para o From', 'mx.google.com; dmarc=pass header.from=evil.com', 'fail'],
  ])('%s → %s', (_l, header, expected) => {
    expect(senderAuthVerdict(header as string | null, FROM)).toBe(expected);
  });
});

import { collectMimeParts, extractReferencedMessageIds, isCalendarMessage, matchesOurThread } from './inbound-classifier';

const ownDomains = ['v4company.com', 'v4companyamaral.com'];
const lead = { from: 'Wagner <wagner@dacolonia.com.br>' };

/** Assuntos reais das 12 conversas falsas encerradas em 19/10/2026 (caixa do Vini, piloto BDR-3). */
const REAL_CALENDAR_SUBJECTS = [
  'Declined: douglas@dwwtecnologia.com.br has declined V4 Company + Corretei',
  'Convite: V4 Company + DaColônia Alimentos Naturais Ltda - qui. 24 set. 2026 11am - 12pm (BRT) (Vinicius Mercante)',
  'Decline: V4 Company + DaColônia Alimentos Naturais Ltda',
  'Re: Decline: V4 Company + DaColônia Alimentos Naturais Ltda',
  'Aceitar: Convite atualizado: V4 Company + DaColônia Alimentos Naturais Ltda - sex. 2 out. 2026 2pm - 3pm (BRT) (wagner@dacolonia.com.br)',
  'Convite: V4 Company + Leviora - qua. 30 set. 2026 1pm - 2:30pm (BRT) (Vinicius Mercante)',
  'Convite: Integração V4 - Köli  - qui. 1 out. 2026 10:30am - 11:30am (BRT) (vinicius.mercante@v4company.com)',
  'Convite: V4 Company + TONDO S/A. - qua. 14 out. 2026 3pm - 4:30pm (BRT) (Vinicius Mercante)',
  'Convite: V4 Company + Grupo Prever - qua. 14 out. 2026 5pm - 6:30pm (BRT) (Vinicius Mercante)',
  'Convite atualizado: V4 Company + TONDO (Orquídea alimentos) - seg. 19 out. 2026 11am - 12pm (BRT) (Vinicius Mercante)',
  'Convite atualizado: V4 Company + Grupo Prever - qui. 15 out. 2026 4pm - 5:30pm (BRT) (Vinicius Mercante)',
];
/** Também reais: NÃO são agenda — são e-mail avulso de lead; a regra 2 é quem barra a conversa. */
const REAL_PLAIN_SUBJECTS = [
  'Re: Proposta Comercial V4 Company <> DaColônia Alimentos Naturais',
  'Re: Aurora Fine Brands + V4 Company (Reunião)',
  'RES: Aurora Fine Brands + V4 Company (Reunião)',
];

describe('regra 1 — convite/resposta de agenda é calendar, nunca lead', () => {
  it('parte MIME text/calendar (mesmo com parâmetro method=REQUEST)', () => {
    expect(classifyInbound({ headers: { ...lead, subject: 'Reunião' }, ownEmails: own, partMimeTypes: ['multipart/mixed', 'text/calendar; method=REQUEST'] })).toBe('calendar');
    expect(classifyInbound({ headers: { ...lead, subject: 'Reunião' }, ownEmails: own, mimeType: 'text/calendar' })).toBe('calendar');
  });
  it('anexo .ics ou application/ics', () => {
    expect(classifyInbound({ headers: { ...lead, subject: 'Reunião' }, ownEmails: own, attachmentNames: ['invite.ICS'] })).toBe('calendar');
    expect(classifyInbound({ headers: { ...lead, subject: 'Reunião' }, ownEmails: own, partMimeTypes: ['application/ics'] })).toBe('calendar');
  });
  it('header Content-Class de calendário (Outlook/Exchange)', () => {
    expect(classifyInbound({ headers: { ...lead, subject: 'Reunião', 'content-class': 'urn:content-classes:calendarmessage' }, ownEmails: own })).toBe('calendar');
  });
  it('remetente calendar-notification@google.com', () => {
    expect(classifyInbound({ headers: { from: 'Google Agenda <calendar-notification@google.com>', subject: 'Lembrete' }, ownEmails: own })).toBe('calendar');
  });
  it('"via Google Agenda" / "via Google Calendar" no From', () => {
    expect(classifyInbound({ headers: { from: 'Wagner (via Google Agenda) <wagner@dacolonia.com.br>', subject: 'Reunião' }, ownEmails: own })).toBe('calendar');
    expect(classifyInbound({ headers: { from: 'Wagner (via Google Calendar) <wagner@dacolonia.com.br>', subject: 'Meeting' }, ownEmails: own })).toBe('calendar');
  });
  it.each([
    'Convite: x', 'Convite atualizado: x', 'Aceitar: x', 'Aceito: x', 'Recusado: x', 'Talvez: x',
    'Invitation: x', 'Updated invitation: x', 'Accepted: x', 'Declined: x', 'Tentative: x',
  ])('prefixo de assunto "%s"', (subject) => {
    expect(classifyInbound({ headers: { ...lead, subject }, ownEmails: own })).toBe('calendar');
  });
  it('padrão de data do Google ("- qua. 14 out. 2026") sem prefixo', () => {
    expect(classifyInbound({ headers: { ...lead, subject: 'V4 Company + Leviora - qua. 30 set. 2026 1pm - 2:30pm (BRT)' }, ownEmails: own })).toBe('calendar');
    expect(isCalendarMessage({ headers: { subject: 'Reunião - sáb. 1 mai 2027' } })).toBe(true);
  });
  it.each(REAL_CALENDAR_SUBJECTS)('assunto real: "%s" → calendar', (subject) => {
    expect(classifyInbound({ headers: { ...lead, subject }, ownEmails: own })).toBe('calendar');
  });
  it.each(REAL_PLAIN_SUBJECTS)('assunto real: "%s" NÃO é agenda (segue como lead; regra 2 decide a conversa)', (subject) => {
    expect(classifyInbound({ headers: { ...lead, subject }, ownEmails: own })).toBe('lead');
  });
  it('agenda vence auto-reply, mas bounce vence agenda', () => {
    expect(classifyInbound({ headers: { ...lead, subject: 'Convite: x', 'auto-submitted': 'auto-generated' }, ownEmails: own })).toBe('calendar');
    expect(classifyInbound({ headers: { from: 'mailer-daemon@googlemail.com', subject: 'Convite: x' }, ownEmails: own })).toBe('bounce');
  });
  it('collectMimeParts percorre a árvore e junta MIME e anexos', () => {
    expect(collectMimeParts({ mimeType: 'multipart/mixed', parts: [
      { mimeType: 'text/plain' },
      { mimeType: 'application/ics', filename: 'invite.ics', parts: [] },
    ] })).toEqual({ mimeTypes: ['multipart/mixed', 'text/plain', 'application/ics'], attachmentNames: ['invite.ics'] });
    expect(collectMimeParts(undefined)).toEqual({ mimeTypes: [], attachmentNames: [] });
  });
});

describe('regra 2 — conversa só quando continua um thread que NÓS começamos', () => {
  // Envio real da cadência "BDR IA — Arroz (e-mail auto)" (DaColônia, 24/09) e uma resposta do agente
  const sends = [
    { thread_id: '1a0c8c76f59c7353', rfc_message_id: '<muqxfwdh.9tg89rac2q@v4company.com>' },
    { rfc_message_id: '<bdr-9f842307-f3f3-4a59-8116-187adb254c3e@v4companyamaral.com>' },
  ];
  it('casa pelo thread_id do Gmail igual ao metadata.thread_id do envio da cadência', () => {
    expect(matchesOurThread({ threadId: '1a0c8c76f59c7353', headers: { subject: 'Re: Previsibilidade de vendas na Dacolônia Alimentos' } }, sends)).toBe(true);
  });
  it('casa pelo In-Reply-To contendo o rfc_message_id do envio (thread diferente)', () => {
    expect(matchesOurThread({ threadId: 'outra-thread', headers: { 'in-reply-to': '<muqxfwdh.9tg89rac2q@v4company.com>' } }, sends)).toBe(true);
  });
  it('casa pelo References contendo o Message-ID do agente (<bdr-…>), sem distinguir maiúsculas', () => {
    expect(matchesOurThread({ threadId: null, headers: { references: '<abc@lead.com> <BDR-9F842307-f3f3-4a59-8116-187adb254c3e@v4companyamaral.com>' } }, sends)).toBe(true);
  });
  it('negativo: lead desconhecido, thread que não é nosso e sem referência nossa → não é conversa', () => {
    expect(matchesOurThread({ threadId: '1a0ed92b6bd9f9f9', headers: { subject: 'Re: Proposta Comercial V4 Company <> DaColônia Alimentos Naturais', 'in-reply-to': '<xyz@dacolonia.com.br>' } }, sends)).toBe(false);
    expect(matchesOurThread({ threadId: '1a0c8c76f59c7353', headers: {} }, [])).toBe(false);
  });
  it('extractReferencedMessageIds junta In-Reply-To e References sem repetir', () => {
    expect(extractReferencedMessageIds({ 'in-reply-to': '<a@x.com>', references: '<b@x.com>\r\n <a@x.com>' })).toEqual(['<a@x.com>', '<b@x.com>']);
    expect(extractReferencedMessageIds({})).toEqual([]);
  });
});

describe('regra 3 — remetente do nosso domínio é own', () => {
  it('colega da casa que não é caixa BDR (foi assim que convites encaminhados viraram conversa)', () => {
    expect(classifyInbound({ headers: { from: 'Guilherme <guilhermefernandes.marques@v4company.com>', subject: 'Re: Aurora Fine Brands + V4 Company (Reunião)' }, ownEmails: own, ownDomains })).toBe('own');
    expect(classifyInbound({ headers: { from: 'Ana <analuiza@v4companyamaral.com>', subject: 'Oi' }, ownEmails: own, ownDomains })).toBe('own');
  });
  it('domínio parecido não é da casa', () => {
    expect(classifyInbound({ headers: { from: 'x@notv4company.com', subject: 'Re: V4' }, ownEmails: own, ownDomains })).toBe('lead');
  });
});
