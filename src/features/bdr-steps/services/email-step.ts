/**
 * BDR — E-mail da Ana como atividade da cadência (fora do motor auto_email).
 *
 * O n8n reserva o passo de e-mail (claim, channel 'email'), a IA escreve assunto e
 * corpo e manda para POST /api/v1/bdr/steps/email. A rota envia pela caixa da Ana e
 * registra no histórico. Regras puras aqui; I/O na rota.
 */
import { isUuid } from '@/lib/utils/uuid';

import type { ParseResult } from './external-step';

export interface EmailStepRequest {
  /** Passo reservado no claim. Ausente só no modo teste. */
  executionId: string | null;
  /** Modo teste: envia para este endereço, sem lead, sem registro, sem avançar passo. */
  testePara: string | null;
  remetenteEmail: string;
  assunto: string;
  /** Texto simples escrito pela IA (parágrafos separados por linha em branco). */
  corpo: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ASSUNTO = 150;
const MAX_CORPO = 4000;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseEmailStepRequest(body: unknown): ParseResult<EmailStepRequest> {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  const remetenteEmail = str(b.remetente_email)?.toLowerCase() ?? null;
  if (!remetenteEmail || !EMAIL_RE.test(remetenteEmail)) return { ok: false, error: 'remetente_email obrigatório' };

  const testePara = str(b.teste_para)?.toLowerCase() ?? null;
  if (testePara && !EMAIL_RE.test(testePara)) return { ok: false, error: 'teste_para inválido' };

  const executionId = str(b.execution_id);
  if (!testePara && (!executionId || !isUuid(executionId))) {
    return { ok: false, error: 'execution_id obrigatório (uuid) fora do modo teste' };
  }
  if (testePara && executionId) return { ok: false, error: 'modo teste não aceita execution_id' };

  const assunto = str(b.assunto);
  if (!assunto) return { ok: false, error: 'assunto obrigatório' };
  if (assunto.length > MAX_ASSUNTO) return { ok: false, error: `assunto acima de ${MAX_ASSUNTO} caracteres` };

  const corpo = str(b.corpo);
  if (!corpo) return { ok: false, error: 'corpo obrigatório' };
  if (corpo.length > MAX_CORPO) return { ok: false, error: `corpo acima de ${MAX_CORPO} caracteres` };

  return { ok: true, value: { executionId: testePara ? null : executionId, testePara, remetenteEmail, assunto, corpo } };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Texto simples → HTML de e-mail pessoal (parágrafos e quebras de linha, sem estilo de newsletter). */
export function textoParaHtml(texto: string): string {
  return texto
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

/** Assunto de resposta na mesma conversa: herda o assunto original com "Re:". */
export function assuntoDeResposta(original: string): string {
  const s = original.trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

export type DesfechoEnvio =
  | 'enviado'
  /** Gmail recusou por causa do destinatário/conteúdo: registra falha e avança o passo. */
  | 'falhou_avanca'
  /** Gmail recusou por causa da caixa (token, permissão, limite): nada saiu, devolve o passo. */
  | 'caixa_indisponivel'
  /** Sem resposta definitiva: pode ter saído. Registra como incerto e avança — nunca reenvia. */
  | 'incerto';

export function desfechoDoEnvio(r: {
  success: boolean;
  httpStatus?: number | null;
  stage?: 'request' | 'response' | 'network' | null;
}): DesfechoEnvio {
  if (r.success) return 'enviado';
  if (r.stage === 'response' && r.httpStatus != null) {
    if ([401, 403, 429].includes(r.httpStatus)) return 'caixa_indisponivel';
    if ([400, 404, 413, 422].includes(r.httpStatus)) return 'falhou_avanca';
  }
  // Falhas antes de chamar o Gmail (sem conexão, token não renovável) voltam sem `stage`
  // e não enviaram nada. Exceção na chamada vira stage 'network' na rota: pode ter saído.
  if (r.stage == null || r.stage === 'request') return 'caixa_indisponivel';
  return 'incerto';
}
