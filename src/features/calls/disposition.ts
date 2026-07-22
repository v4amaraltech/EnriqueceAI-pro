// Mapa disposition → ação de cadência (Epic 7 / story 7.6). Módulo PURO —
// importável tanto pelo client (decidir mostrar o date-picker de callback)
// quanto pelo server (orquestrar advance/reschedule).
//
// Decisão (plano §E + decisão #3): conversa real avança; ocupado/não-atendeu
// reagenda (callback no horário escolhido pelo SDR); erro técnico não fecha.
//
// Mora em `features/calls` (e não em `whatsapp-calls`) porque o desfecho passou
// a ser capturado nos DOIS discadores — API4COM e Ligação via WhatsApp.
import type { CallStatus } from './types';

export type DispositionAction = 'advance' | 'reschedule' | 'none';

export function mapDispositionToAction(status: CallStatus): DispositionAction {
  switch (status) {
    case 'significant':
    case 'not_significant':
      return 'advance';
    case 'busy':
    case 'no_contact':
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
export const DISPOSITION_OPTIONS: DispositionOption[] = [
  { value: 'significant', label: 'Conversa relevante', hint: 'Avança a cadência' },
  { value: 'not_significant', label: 'Atendeu, sem avanço', hint: 'Avança a cadência' },
  { value: 'busy', label: 'Ocupado', hint: 'Reagenda (ligar de novo)' },
  { value: 'no_contact', label: 'Não atendeu', hint: 'Reagenda (ligar de novo)' },
  { value: 'not_connected', label: 'Falha técnica', hint: 'Volta para a fila' },
];
