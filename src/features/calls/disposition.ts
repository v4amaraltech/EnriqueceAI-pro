// Mapa disposition → ação de cadência (Epic 7 / story 7.6). Módulo PURO —
// importável tanto pelo client (decidir mostrar o date-picker de callback)
// quanto pelo server (orquestrar advance/reschedule).
//
// Regra de negócio (validada com o comercial em 22/jul/2026):
//
// Reagendar é um COMPROMISSO QUE O LEAD PEDIU — só existe quando houve conversa.
// "Pediu para ligar depois" (`busy`) é justamente isso: o lead ATENDEU e pediu
// para ligar em outro momento.
//
// "Não atendeu" (`no_contact`) NÃO reagenda: ninguém falou com ninguém, então
// não há horário combinado. A cadência já tem os próximos toques programados e
// cuida da retentativa sozinha — o SDR só conclui a atividade.
//
// (O Epic 7 assumia que não-atendeu reagendava. Na operação real não é assim:
// aquilo obrigava o SDR a escolher uma data no caso MAIS comum do dia.)
//
// Falha técnica não fecha a atividade — ela volta para a fila.
//
// Mora em `features/calls` (e não em `whatsapp-calls`) porque o desfecho passou
// a ser capturado nos DOIS discadores — API4COM e Ligação via WhatsApp.
import type { CallStatus } from './types';

export type DispositionAction = 'advance' | 'reschedule' | 'none';

export function mapDispositionToAction(status: CallStatus): DispositionAction {
  switch (status) {
    case 'significant':
    case 'not_significant':
    case 'no_contact':
      return 'advance';
    // Só `busy` ("Pediu para ligar depois") reagenda — houve conversa e um
    // horário combinado. `no_contact` cai no 'advance' acima junto com os
    // demais: a cadência segue com os próximos toques já programados.
    case 'busy':
      return 'reschedule';
    case 'not_connected':
      return 'none';
  }
}

export interface DispositionOption {
  value: CallStatus;
  label: string;
  hint: string;
}

// Ordem e rótulos exibidos no seletor pós-chamada.
//
// NOTA sobre `busy`: o rótulo NÃO é "Ocupado". Em telefonia isso sugere linha
// ocupada / ninguém atendeu, mas aqui significa o oposto — o lead ATENDEU e
// pediu para ligar depois. O rótulo antigo já induziu leitura errada do fluxo;
// o valor no banco segue `busy` (sem migration), só a exibição mudou.
export const DISPOSITION_OPTIONS: DispositionOption[] = [
  { value: 'significant', label: 'Conversa relevante', hint: 'Avança a cadência' },
  { value: 'not_significant', label: 'Atendeu, sem avanço', hint: 'Avança a cadência' },
  { value: 'busy', label: 'Pediu para ligar depois', hint: 'Agenda o retorno combinado' },
  { value: 'no_contact', label: 'Não atendeu', hint: 'Segue a cadência' },
  { value: 'not_connected', label: 'Falha técnica', hint: 'Volta para a fila' },
];
