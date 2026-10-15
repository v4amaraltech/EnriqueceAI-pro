/**
 * BDR — WhatsApp da Ana como atividade da cadência. Regras aprovadas em 15/10/2026:
 * só para quem deu sinal (autorizou na ligação, respondeu e-mail ou abriu 2+ e-mails),
 * no máximo 3 por lead, só celular, nunca para quem tem bloqueio, recusou ou descadastrou.
 * Regras puras aqui; a rota /api/v1/bdr/steps/whatsapp faz o I/O. O envio é do n8n.
 */
import { isUuid } from '@/lib/utils/uuid';

import type { ParseResult } from './external-step';

export const MAX_WHATSAPP_POR_LEAD = 3;
export const MIN_ABERTURAS_EMAIL = 2;
/** Teto diário de WhatsApps da Ana no início (número novo sobe aos poucos). */
export const MAX_WHATSAPP_POR_DIA = 15;

/** Celular brasileiro em dígitos (55 + DDD + 9 + 8 dígitos) ou null. Fixo e número estrangeiro → null. */
export function celularBr(bruto: unknown): string | null {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 11) d = `55${d}`;
  if (d.length !== 13 || !d.startsWith('55')) return null;
  const ddd = Number(d.slice(2, 4));
  if (ddd < 11 || ddd > 99) return null;
  return d[4] === '9' ? d : null;
}

/** Primeiro celular entre o telefone principal e a lista `phones` do lead. */
export function escolherCelular(telefone: unknown, phones: unknown): string | null {
  const lista = Array.isArray(phones) ? phones : [];
  const candidatos = [telefone, ...lista.map((p) => (p && typeof p === 'object' ? (p as Record<string, unknown>).numero : p))];
  for (const c of candidatos) {
    const cel = celularBr(c);
    if (cel) return cel;
  }
  return null;
}

/** `whatsapp_autorizado` nas informações-chave que a Ana salvou na ligação ("sim", "true", "s"). */
export function autorizouNasInformacoes(listas: unknown[]): boolean {
  for (const lista of listas) {
    if (!Array.isArray(lista)) continue;
    for (const i of lista) {
      if (!i || typeof i !== 'object') continue;
      const { chave, valor } = i as Record<string, unknown>;
      if (String(chave ?? '').toLowerCase() === 'whatsapp_autorizado' && /^(sim|s|true|yes|autorizado)\b/i.test(String(valor ?? '').trim())) {
        return true;
      }
    }
  }
  return false;
}

export interface SinaisWhatsApp {
  bloqueio: string | null;
  descadastrado: boolean;
  perdido: boolean;
  recusouNaLigacao: boolean;
  whatsappInvalido: boolean;
  celular: string | null;
  enviadosPelaAna: number;
  autorizouNaLigacao: boolean;
  respondeuEmail: boolean;
  aberturasEmail: number;
}

export type DecisaoWhatsApp =
  | { enviar: true; telefone: string; sinal: 'autorizou_na_ligacao' | 'respondeu_email' | 'abriu_emails' }
  | { enviar: false; motivo: string };

export function decidirWhatsApp(s: SinaisWhatsApp): DecisaoWhatsApp {
  if (s.bloqueio) return { enviar: false, motivo: `bloqueio_${s.bloqueio}` };
  if (s.recusouNaLigacao) return { enviar: false, motivo: 'recusou_na_ligacao' };
  if (s.descadastrado) return { enviar: false, motivo: 'descadastrado' };
  if (s.perdido) return { enviar: false, motivo: 'lead_perdido' };
  if (s.enviadosPelaAna >= MAX_WHATSAPP_POR_LEAD) return { enviar: false, motivo: 'limite_3_whatsapps' };
  if (s.whatsappInvalido) return { enviar: false, motivo: 'whatsapp_invalido' };
  if (!s.celular) return { enviar: false, motivo: 'sem_celular' };
  if (s.autorizouNaLigacao) return { enviar: true, telefone: s.celular, sinal: 'autorizou_na_ligacao' };
  if (s.respondeuEmail) return { enviar: true, telefone: s.celular, sinal: 'respondeu_email' };
  if (s.aberturasEmail >= MIN_ABERTURAS_EMAIL) return { enviar: true, telefone: s.celular, sinal: 'abriu_emails' };
  return { enviar: false, motivo: 'sem_sinal' };
}

export interface WhatsAppStepRequest {
  acao: 'checar' | 'iniciar' | 'registrar';
  executionId: string;
  /** registrar */
  status: 'enviado' | 'falhou' | 'incerto' | null;
  texto: string | null;
  messageId: string | null;
  erro: string | null;
}

const ACOES = new Set(['checar', 'iniciar', 'registrar']);
const STATUS = new Set(['enviado', 'falhou', 'incerto']);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseWhatsAppStepRequest(body: unknown): ParseResult<WhatsAppStepRequest> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const acao = str(b.acao);
  if (!acao || !ACOES.has(acao)) return { ok: false, error: 'acao deve ser checar, iniciar ou registrar' };
  const executionId = str(b.execution_id);
  if (!executionId || !isUuid(executionId)) return { ok: false, error: 'execution_id obrigatório (uuid)' };

  let status: WhatsAppStepRequest['status'] = null;
  if (acao === 'registrar') {
    const s = str(b.status);
    if (!s || !STATUS.has(s)) return { ok: false, error: 'status deve ser enviado, falhou ou incerto' };
    status = s as WhatsAppStepRequest['status'];
  }
  const texto = str(b.texto);
  if (texto && texto.length > 1000) return { ok: false, error: 'texto acima de 1000 caracteres' };

  return {
    ok: true,
    value: {
      acao: acao as WhatsAppStepRequest['acao'],
      executionId,
      status,
      texto,
      messageId: str(b.message_id)?.slice(0, 200) ?? null,
      erro: str(b.erro)?.slice(0, 300) ?? null,
    },
  };
}
