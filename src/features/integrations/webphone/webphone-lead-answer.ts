// O webphone atende a perna do RAMAL na hora (auto-atendimento do INVITE da
// API4COM), então `call.answeredAt` do cliente diz só que a página atendeu —
// não que o LEAD atendeu. Quem sabe isso é o webhook da API4COM, que grava
// `answered_at` (channel-answer da perna do lead) e, no fim, `hangup_cause`.
// Módulo PURO: a leitura da linha de `calls` vira um dos três estados abaixo.

export type LeadAnswer = 'answered' | 'not_answered' | 'unknown';

export interface CallAnswerSignals {
  answered_at: string | null;
  hangup_cause: string | null;
  duration_seconds: number | null;
}

/**
 * - `answered_at` presente → o lead (ou a caixa postal dele) atendeu;
 * - sem `answered_at` mas com `hangup_cause` → a ligação acabou sem atender
 *   (NUMBER_CHANGED, ORIGINATOR_CANCEL, NO_ANSWER…);
 * - nada ainda → o webhook não chegou: desconhecido.
 */
export function leadAnswerFromCallRow(row: CallAnswerSignals | null | undefined): LeadAnswer {
  if (!row) return 'unknown';
  if (row.answered_at) return 'answered';
  if (row.hangup_cause) return 'not_answered';
  if ((row.duration_seconds ?? 0) > 0) return 'answered';
  return 'unknown';
}

/** Intervalo entre consultas enquanto o webhook não chegou. */
export const LEAD_ANSWER_POLL_INTERVAL_MS = 3_000;
/** Teto de consultas por ligação (~2 min): depois disso fica "desconhecido". */
export const LEAD_ANSWER_MAX_POLLS = 40;

/**
 * Sinal de "atendida" para os discadores e o modal de resultado: a palavra do
 * webhook vale mais que a do cliente; sem webhook ainda, usa o `fallback`
 * (atendimento da perna do ramal / duração medida na tela).
 */
export function leadConnected(leadAnswer: LeadAnswer, fallback: boolean): boolean {
  if (leadAnswer === 'answered') return true;
  if (leadAnswer === 'not_answered') return false;
  return fallback;
}

/**
 * Ligação com linha em `calls` (API4COM): só o webhook diz que o lead atendeu.
 * O ramal atende o INVITE na hora e a operadora toca a locução ("número fora
 * do ar ou indisponível") nessa perna, então o sinal do cliente não vale.
 * Até o `answered_at` chegar, a tela mostra "Não atendida".
 */
export function leadAnsweredByServer(leadAnswer: LeadAnswer): boolean {
  return leadAnswer === 'answered';
}

/**
 * Segundos de conversa a registrar: 0 quando o lead não atendeu (o tempo
 * medido na tela é da perna do ramal, não conversa); senão o medido.
 */
export function effectiveCallSeconds(leadAnswer: LeadAnswer, measuredSeconds: number): number {
  return leadAnswer === 'not_answered' ? 0 : measuredSeconds;
}

// Motivo da queda, em português simples, para o painel mostrar quando o lead
// NÃO atendeu. Sem isso a tela só dizia "Ligação finalizada 00:00" e parecia
// que o webphone nem tinha discado (03/11/2026: a operadora recusava ~40% das
// ligações com NORMAL_TEMPORARY_FAILURE e o SDR achava que era defeito).
// Causas = as que o webhook da API4COM grava em `calls.hangup_cause`.
const CARRIER_RETRY = 'Falha na operadora. Tente de novo em instantes.';

const HANGUP_REASON: Record<string, string> = {
  NORMAL_TEMPORARY_FAILURE: CARRIER_RETRY,
  NETWORK_OUT_OF_ORDER: CARRIER_RETRY,
  EXCHANGE_ROUTING_ERROR: CARRIER_RETRY,
  RECOVERY_ON_TIMER_EXPIRE: 'A operadora não respondeu a tempo. Tente de novo.',
  // NUMBER_CHANGED é "não atendeu" (decisão do Vinicius, 12/11): quando o SDR
  // registrou desfecho, foram 43 no_answer e nenhuma caixa postal. O guia
  // oficial da API4COM ainda descreve a causa como caixa postal; o rótulo
  // segue a prática do SDR. connected permanece false.
  // Exibição "Fora de área" (decisão do Vinicius, 13/11): no CRM segue no_answer.
  NUMBER_CHANGED: 'Fora de área.',
  SUBSCRIBER_ABSENT: 'Fora de área.',
  ALLOTTED_TIMEOUT: 'Tempo expirado.',
  UNALLOCATED_NUMBER: 'Este número não existe.',
  INVALID_NUMBER_FORMAT: 'Número em formato inválido.',
  USER_BUSY: 'Linha ocupada.',
  BUSY: 'Linha ocupada.',
  NO_ANSWER: 'O lead não atendeu.',
  NO_USER_RESPONSE: 'O lead não atendeu.',
  MISSED: 'O lead não atendeu.',
  CALL_REJECTED: 'O lead recusou a ligação.',
  VOICEMAIL: 'Caiu na caixa postal.',
  ORIGINATOR_CANCEL: 'Ligação encerrada antes de o lead atender.',
  NORMAL_CLEARING: 'Ligação encerrada antes de o lead atender.',
};

const GENERIC_REASON = 'A operadora não completou a ligação.';

/**
 * "Fora de área": a operadora diz que o número está fora do ar, fora de área
 * ou indisponível. Só muda o rótulo na tela; o desfecho gravado continua
 * `no_answer` ("Não atendeu" no CRM). Número inexistente (UNALLOCATED_NUMBER)
 * segue como Falha técnica.
 */
export const OUT_OF_AREA_LABEL = 'Fora de área';
const OUT_OF_AREA_CAUSES = new Set(['NUMBER_CHANGED', 'SUBSCRIBER_ABSENT']);
const OUT_OF_AREA_SPEECH =
  /fora (de|da) (área|area)|fora (do ar|de serviço|de servico)|(desligado|indispon[ií]vel) ou fora|fora .{0,40}indispon/i;

export function isOutOfAreaCall(input: {
  hangupCause?: string | null;
  transcript?: string | null;
}): boolean {
  const cause = input.hangupCause?.trim().toUpperCase();
  if (cause && OUT_OF_AREA_CAUSES.has(cause)) return true;
  return Boolean(input.transcript && OUT_OF_AREA_SPEECH.test(input.transcript));
}

/**
 * Texto do motivo para o SDR quando o lead não atendeu; `null` enquanto o
 * webhook não trouxe a causa. Causa desconhecida vira um texto genérico.
 */
export function hangupReasonLabel(hangupCause: string | null | undefined): string | null {
  const cause = hangupCause?.trim().toUpperCase();
  if (!cause) return null;
  return HANGUP_REASON[cause] ?? GENERIC_REASON;
}
