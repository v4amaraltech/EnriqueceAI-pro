// Mapa disposition → ação de cadência (Epic 7 / story 7.6). Módulo PURO —
// importável tanto pelo client (decidir mostrar o date-picker de callback)
// quanto pelo server (orquestrar advance/reschedule).
//
// O desfecho é o enum PRÓPRIO `CallDisposition` (coluna calls.sdr_disposition),
// separado da telemetria `CallStatus`. Cada valor descreve o desfecho comercial,
// sem a antiga colisão do `busy` (que na telemetria é "linha ocupada" e aqui era
// "o lead pediu para ligar depois").
//
// Regra de negócio (validada com o comercial em 22/jul/2026):
//
// Reagendar é um COMPROMISSO QUE O LEAD PEDIU — só existe quando houve conversa.
// `callback_requested` ("Pediu para ligar depois") é justamente isso: o lead
// ATENDEU e pediu para ligar em outro momento.
//
// `no_answer` ("Não atendeu") NÃO reagenda: ninguém falou com ninguém, então não
// há horário combinado. A cadência já tem os próximos toques programados e cuida
// da retentativa sozinha — o SDR só conclui a atividade.
//
// `technical_failure` ("Falha técnica") não fecha a atividade — ela volta para a
// fila.
//
// Mora em `features/calls` (e não em `whatsapp-calls`) porque o desfecho passou
// a ser capturado nos DOIS discadores — API4COM e Ligação via WhatsApp.
import type { CallDisposition } from './types';

export type DispositionAction = 'advance' | 'reschedule' | 'none';

export function mapDispositionToAction(disposition: CallDisposition): DispositionAction {
  switch (disposition) {
    case 'relevant_conversation':
    case 'answered_no_progress':
    case 'no_answer':
    // Caixa postal / secretária: a linha atendeu mas não houve humano. Trata
    // como "não atendeu" — segue a cadência (os próximos toques cuidam da
    // retentativa); conta como tentativa no histórico.
    case 'voicemail':
      return 'advance';
    // Só `callback_requested` ("Pediu para ligar depois") reagenda — houve
    // conversa e um horário combinado. `no_answer` cai no 'advance' acima junto
    // com os demais: a cadência segue com os próximos toques já programados.
    case 'callback_requested':
      return 'reschedule';
    case 'technical_failure':
      return 'none';
  }
}

export interface DispositionOption {
  value: CallDisposition;
  label: string;
  hint: string;
}

// Ordem e rótulos exibidos no seletor pós-chamada.
export const DISPOSITION_OPTIONS: DispositionOption[] = [
  { value: 'relevant_conversation', label: 'Conversa relevante', hint: 'Avança a cadência' },
  { value: 'answered_no_progress', label: 'Atendeu, sem avanço', hint: 'Avança a cadência' },
  // Caixa postal/secretária, mas rotulada "Não atendeu" para o SDR: do ponto de
  // vista dele ninguém atendeu, e o modelo mental é binário (atendeu/não). O
  // valor gravado continua `voicemail`, então histórico e relatórios mostram o
  // rótulo preciso ("Caixa postal", via call-attempt) e a métrica de % caixa
  // postal fica preservada. Só aparece na tela ATENDIDA (o `no_answer` real fica
  // escondido lá), então nunca há dois "Não atendeu" no mesmo grid.
  { value: 'voicemail', label: 'Não atendeu', hint: 'Segue a cadência' },
  { value: 'callback_requested', label: 'Pediu para ligar depois', hint: 'Agenda o retorno combinado' },
  { value: 'no_answer', label: 'Não atendeu', hint: 'Segue a cadência' },
  { value: 'technical_failure', label: 'Falha técnica', hint: 'Volta para a fila' },
];

// Rótulos para RELATÓRIOS, na ordem de exibição. Diferem do seletor num ponto:
// `voicemail` aparece como "Caixa postal" (o preciso), não como "Não atendeu".
export const DISPOSITION_REPORT_LABELS: Record<CallDisposition, string> = {
  relevant_conversation: 'Conversa relevante',
  answered_no_progress: 'Atendeu, sem avanço',
  callback_requested: 'Pediu para ligar depois',
  voicemail: 'Caixa postal',
  no_answer: 'Não atendeu',
  technical_failure: 'Falha técnica',
};

// Desfechos que PRESSUPÕEM que a LINHA atendeu — só fazem sentido quando a
// telemetria diz que houve atendimento. `callback_requested` entra porque
// "Pediu para ligar depois" só existe se o lead atendeu; `voicemail` entra
// porque caixa postal/secretária só ocorre quando a linha atende (a máquina
// "pega") — numa ligação que ninguém atende não há caixa postal.
const OUTCOMES_REQUIRING_ANSWER: ReadonlySet<CallDisposition> = new Set<CallDisposition>([
  'relevant_conversation',
  'answered_no_progress',
  'callback_requested',
  'voicemail',
]);

// `no_answer` ("Não atendeu") pressupõe NÃO-atendimento.
const OUTCOME_REQUIRING_NO_ANSWER: CallDisposition = 'no_answer';

/**
 * Restringe os desfechos oferecidos ao SDR conforme o sinal de telemetria, para
 * o formulário não permitir contradições com o que o sistema já sabe (jul/2026:
 * 181 ligações marcadas "Não atendeu" tinham `answered_at` preenchido).
 *
 *  - atendida     → esconde "Não atendeu" (`no_answer`);
 *  - não atendida → esconde os que exigem conversa (`relevant_conversation`,
 *                   `answered_no_progress`, `callback_requested`).
 *
 * "Falha técnica" (`technical_failure`) fica disponível nos dois casos — é
 * neutra quanto a atendimento (linha caiu, problema de áudio/sistema).
 */
export function dispositionOptionsForTelemetry(connected: boolean): DispositionOption[] {
  if (connected) {
    return DISPOSITION_OPTIONS.filter((o) => o.value !== OUTCOME_REQUIRING_NO_ANSWER);
  }
  return DISPOSITION_OPTIONS.filter((o) => !OUTCOMES_REQUIRING_ANSWER.has(o.value));
}
