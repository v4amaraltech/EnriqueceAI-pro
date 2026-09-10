// Efetividade da ligação — "alguém atendeu?" e "virou conversa relevante?".
// Módulo PURO, usado pela tela Estatísticas › Ligações.
//
// NÃO é a métrica de conexão. "Taxa de conexão" continua sendo
// `isConnectedCall()` (connection.ts) — só telefonia, o mesmo número do Painel
// de Ligações e do BI. Aqui a pergunta é outra: dá para AFIRMAR que uma pessoa
// atendeu? A telefonia afirma (answered + ≥50s) ou o SDR afirma (marcou um
// desfecho que só existe com humano do outro lado).
//
// Por que o SDR entra aqui: há ramal sem sinal de telefonia nenhum — a org
// V4 Company Julio Cesar (set/2026) teve 1.057 ligações sem UM `answered_at`
// porque a API4COM da conta não entregou webhook. Só pela telefonia, a tela
// mostrava 100% "Não Conectada" com 8 conversas relevantes marcadas pelo SDR.
import { isConnectedCall, type CallConnectionSignals } from './connection';
import type { CallDisposition } from './types';

/** Desfechos que o SDR só pode marcar se uma PESSOA atendeu. */
const HUMAN_ANSWER_DISPOSITIONS: ReadonlySet<CallDisposition> = new Set<CallDisposition>([
  'relevant_conversation',
  'answered_no_progress',
  'callback_requested',
]);

/**
 * Uma pessoa atendeu: a telefonia confirmou conversa (regra canônica de
 * conexão, que já exclui caixa postal) OU o SDR confirmou atendimento humano.
 * Caixa postal (`voicemail`) nunca conta — nem pelo SDR, nem pela telefonia.
 */
export function isAnsweredByPersonCall(call: CallConnectionSignals): boolean {
  if (call.sdr_disposition && HUMAN_ANSWER_DISPOSITIONS.has(call.sdr_disposition)) return true;
  return isConnectedCall(call);
}

/**
 * A ligação passou pelo discador do app — o único lugar que pede o desfecho ao
 * SDR (modal pós-ligação, nos dois discadores). Ligações feitas por fora
 * (softphone/Kommo criadas pelo webhook, inseridas pelo reconcile, Callface)
 * NUNCA têm desfecho, e não podem contar como "o SDR não informou".
 *
 * Discador API4COM grava `metadata.gateway = 'flux-{orgId}'`
 * (`initiate-api4com-call.ts`); Ligação via WhatsApp grava `origin = 'whatsapp'`.
 */
export function isDialerCall(call: { origin: string | null; gateway: string | null }): boolean {
  return Boolean(call.gateway?.startsWith('flux-')) || call.origin === 'whatsapp';
}

/**
 * Conversa relevante: só o SDR julga relevância. Todo `relevant_conversation`
 * também é `isAnsweredByPersonCall`, então o funil nunca inverte.
 */
export function isRelevantConversationCall(
  call: Pick<CallConnectionSignals, 'sdr_disposition'>,
): boolean {
  return call.sdr_disposition === 'relevant_conversation';
}
