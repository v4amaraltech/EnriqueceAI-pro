import { describe, expect, it } from 'vitest';

import {
  autorizouNasInformacoes,
  celularBr,
  decidirWhatsApp,
  escolherCelular,
  parseWhatsAppStepRequest,
  pedidoParaParar,
  type SinaisWhatsApp,
} from './whatsapp-step';

const EXEC = '0b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
const base: SinaisWhatsApp = {
  bloqueio: null, descadastrado: false, perdido: false, recusouNaLigacao: false, whatsappInvalido: false,
  celular: '5514981219401', enviadosPelaAna: 0, autorizouNaLigacao: false, respondeuEmail: false, aberturasEmail: 0,
};

describe('celularBr / escolherCelular', () => {
  it('aceita celular BR com ou sem 55 e recusa fixo e estrangeiro', () => {
    expect(celularBr('+55 14 98121-9401')).toBe('5514981219401');
    expect(celularBr('(14) 98121-9401')).toBe('5514981219401');
    expect(celularBr('+55 11 3456-7890')).toBeNull();
    expect(celularBr('+90 533 412 8797')).toBeNull();
    expect(celularBr(null)).toBeNull();
  });
  it('procura no telefone e depois na lista phones', () => {
    expect(escolherCelular('+55 11 3456-7890', [{ tipo: 'celular', numero: '+55 21 99876-5432' }])).toBe('5521998765432');
    expect(escolherCelular(null, [])).toBeNull();
  });
});

describe('autorizouNasInformacoes', () => {
  it('lê whatsapp_autorizado das informações-chave da ligação', () => {
    expect(autorizouNasInformacoes([[{ chave: 'whatsapp_autorizado', valor: 'sim' }]])).toBe(true);
    expect(autorizouNasInformacoes([[{ chave: 'WhatsApp_Autorizado', valor: 'Sim, pode mandar' }]])).toBe(true);
    expect(autorizouNasInformacoes([[{ chave: 'whatsapp_autorizado', valor: 'não' }]])).toBe(false);
    expect(autorizouNasInformacoes([null, [{ chave: 'confirmado_eh_jonas', valor: 'sim' }]])).toBe(false);
  });
});

describe('decidirWhatsApp', () => {
  it('sem sinal não envia', () => {
    expect(decidirWhatsApp(base)).toEqual({ enviar: false, motivo: 'sem_sinal' });
    expect(decidirWhatsApp({ ...base, aberturasEmail: 1 })).toEqual({ enviar: false, motivo: 'sem_sinal' });
  });
  it('envia com qualquer um dos três sinais', () => {
    expect(decidirWhatsApp({ ...base, autorizouNaLigacao: true })).toMatchObject({ enviar: true, sinal: 'autorizou_na_ligacao' });
    expect(decidirWhatsApp({ ...base, respondeuEmail: true })).toMatchObject({ enviar: true, sinal: 'respondeu_email' });
    expect(decidirWhatsApp({ ...base, aberturasEmail: 2 })).toMatchObject({ enviar: true, sinal: 'abriu_emails', telefone: '5514981219401' });
  });
  it('bloqueios vencem o sinal', () => {
    const s = { ...base, autorizouNaLigacao: true };
    expect(decidirWhatsApp({ ...s, bloqueio: 'prospeccao' })).toEqual({ enviar: false, motivo: 'bloqueio_prospeccao' });
    expect(decidirWhatsApp({ ...s, recusouNaLigacao: true })).toEqual({ enviar: false, motivo: 'recusou_na_ligacao' });
    expect(decidirWhatsApp({ ...s, descadastrado: true })).toEqual({ enviar: false, motivo: 'descadastrado' });
    expect(decidirWhatsApp({ ...s, perdido: true })).toEqual({ enviar: false, motivo: 'lead_perdido' });
    expect(decidirWhatsApp({ ...s, enviadosPelaAna: 3 })).toEqual({ enviar: false, motivo: 'limite_3_whatsapps' });
    expect(decidirWhatsApp({ ...s, whatsappInvalido: true })).toEqual({ enviar: false, motivo: 'whatsapp_invalido' });
    expect(decidirWhatsApp({ ...s, celular: null })).toEqual({ enviar: false, motivo: 'sem_celular' });
  });
});

describe('parseWhatsAppStepRequest', () => {
  it('valida ação, execution_id e status', () => {
    expect(parseWhatsAppStepRequest({ acao: 'checar', execution_id: EXEC }).ok).toBe(true);
    expect(parseWhatsAppStepRequest({ acao: 'enviar', execution_id: EXEC }).ok).toBe(false);
    expect(parseWhatsAppStepRequest({ acao: 'checar', execution_id: 'x' }).ok).toBe(false);
    expect(parseWhatsAppStepRequest({ acao: 'registrar', execution_id: EXEC }).ok).toBe(false);
    const r = parseWhatsAppStepRequest({ acao: 'registrar', execution_id: EXEC, status: 'enviado', texto: 'Oi', message_id: 'ABC' });
    expect(r.ok && r.value).toMatchObject({ status: 'enviado', texto: 'Oi', messageId: 'ABC' });
    expect(parseWhatsAppStepRequest({ acao: 'registrar', execution_id: EXEC, status: 'enviado', texto: 'a'.repeat(1001) }).ok).toBe(false);
  });
});

describe('resposta do lead', () => {
  const LEAD = '1b6f1c2e-3d4a-4b5c-8d9e-0f1a2b3c4d5e';
  it('exige lead_id e dispensa execution_id', () => {
    expect(parseWhatsAppStepRequest({ acao: 'resposta', texto: 'oi' }).ok).toBe(false);
    const r = parseWhatsAppStepRequest({ acao: 'resposta', lead_id: LEAD, texto: 'Vem mais por distribuidor', message_id: 'wamid.X' });
    expect(r.ok && r.value).toMatchObject({ leadId: LEAD, executionId: null, optOut: false, messageId: 'wamid.X' });
  });
  it('pedido para parar vira opt-out; sem interesse não', () => {
    expect(pedidoParaParar('Pare de me mandar mensagem')).toBe(true);
    expect(pedidoParaParar('Não quero mais receber')).toBe(true);
    expect(pedidoParaParar('Parar de receber')).toBe(true);
    expect(pedidoParaParar('Não tenho interesse no momento')).toBe(false);
    expect(pedidoParaParar('Vem por representante')).toBe(false);
    const r = parseWhatsAppStepRequest({ acao: 'resposta', lead_id: LEAD, texto: 'sair' });
    expect(r.ok && r.value.optOut).toBe(true);
  });
});
