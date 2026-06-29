// State machine pura da Ligação via WhatsApp (story 7.5). Mantida fora do
// componente para ser testável sem WebRTC/DOM. O painel despacha eventos a
// partir das actions (start/end) e — quando o 7.1 existir — do SSE de lifecycle.

export type CallErrorKind = 'mic-denied' | 'session-disconnected' | 'service-error';

export type CallState =
  | { status: 'idle' }
  | { status: 'requesting-mic' }
  | { status: 'ringing' }
  | { status: 'active'; startedAt: number }
  | { status: 'ended' }
  | { status: 'error'; kind: CallErrorKind; message: string };

export type CallEvent =
  | { type: 'DIAL' }
  | { type: 'CALL_STARTED' } // serviço aceitou → chamando
  | { type: 'MIC_DENIED' }
  | { type: 'ANSWERED'; at: number } // (7.1) evento SSE de atendimento
  | { type: 'HANGUP' }
  | { type: 'SERVICE_ERROR'; message: string }
  | { type: 'RESET' };

export const INITIAL_CALL_STATE: CallState = { status: 'idle' };

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case 'RESET':
      return INITIAL_CALL_STATE;
    case 'DIAL':
      return state.status === 'idle' ? { status: 'requesting-mic' } : state;
    case 'MIC_DENIED':
      return state.status === 'requesting-mic'
        ? { status: 'error', kind: 'mic-denied', message: 'Permita o microfone para ligar.' }
        : state;
    case 'CALL_STARTED':
      return state.status === 'requesting-mic' ? { status: 'ringing' } : state;
    case 'ANSWERED':
      return state.status === 'ringing' ? { status: 'active', startedAt: event.at } : state;
    case 'HANGUP':
      return state.status === 'ringing' || state.status === 'active' ? { status: 'ended' } : state;
    case 'SERVICE_ERROR':
      return state.status === 'requesting-mic' || state.status === 'ringing'
        ? { status: 'error', kind: 'service-error', message: event.message }
        : state;
    default:
      return state;
  }
}
