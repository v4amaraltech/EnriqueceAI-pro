// Estado do webphone no navegador. Módulo PURO (testável sem JsSIP/DOM).
//
// O cliente JsSIP (`webphone-client.ts`) traduz os eventos do SIP para
// `WebphoneEvent` e este reducer mantém um único estado observável pela UI.

export type WebphoneRegistration = 'disabled' | 'connecting' | 'registered' | 'disconnected' | 'error';
export type WebphoneCallPhase = 'ringing' | 'in-call' | 'ended';
export type MicPermission = 'unknown' | 'granted' | 'denied';

export interface WebphoneCall {
  id: string;
  remoteNumber: string;
  direction: 'incoming' | 'outgoing';
  /** INVITE veio com `X-Api4comintegratedcall: true` (originado pela API, auto-atendido). */
  integrated: boolean;
  phase: WebphoneCallPhase;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  endCause: string | null;
  muted: boolean;
}

export interface WebphoneState {
  registration: WebphoneRegistration;
  error: string | null;
  mic: MicPermission;
  call: WebphoneCall | null;
}

export type WebphoneEvent =
  | { type: 'disabled' }
  | { type: 'connecting' }
  | { type: 'registered' }
  | { type: 'unregistered' }
  | { type: 'disconnected'; error?: string }
  | { type: 'registration_failed'; cause: string }
  | { type: 'mic'; granted: boolean }
  | { type: 'call_new'; id: string; remoteNumber: string; direction: 'incoming' | 'outgoing'; integrated: boolean; at: number }
  | { type: 'call_accepted'; id: string; at: number }
  | { type: 'call_ended'; id: string; at: number; cause: string | null }
  | { type: 'call_muted'; id: string; muted: boolean }
  | { type: 'call_cleared'; id: string };

export const initialWebphoneState: WebphoneState = {
  registration: 'disabled',
  error: null,
  mic: 'unknown',
  call: null,
};

export function reduceWebphone(state: WebphoneState, event: WebphoneEvent): WebphoneState {
  switch (event.type) {
    case 'disabled':
      return { ...initialWebphoneState, mic: state.mic };
    case 'connecting':
      return { ...state, registration: 'connecting', error: null };
    case 'registered':
      return { ...state, registration: 'registered', error: null };
    case 'unregistered':
      return { ...state, registration: state.registration === 'error' ? 'error' : 'disconnected' };
    case 'disconnected':
      return { ...state, registration: 'disconnected', error: event.error ?? state.error };
    case 'registration_failed':
      return { ...state, registration: 'error', error: `Registro SIP recusado (${event.cause})` };
    case 'mic':
      return { ...state, mic: event.granted ? 'granted' : 'denied' };
    case 'call_new': {
      // Uma ligação por vez: a nova só entra se não houver outra em andamento.
      if (state.call && state.call.phase !== 'ended') return state;
      return {
        ...state,
        call: {
          id: event.id,
          remoteNumber: event.remoteNumber,
          direction: event.direction,
          integrated: event.integrated,
          phase: 'ringing',
          startedAt: event.at,
          answeredAt: null,
          endedAt: null,
          endCause: null,
          muted: false,
        },
      };
    }
    case 'call_accepted':
      if (!state.call || state.call.id !== event.id) return state;
      return { ...state, call: { ...state.call, phase: 'in-call', answeredAt: event.at } };
    case 'call_ended':
      if (!state.call || state.call.id !== event.id) return state;
      return { ...state, call: { ...state.call, phase: 'ended', endedAt: event.at, endCause: event.cause } };
    case 'call_muted':
      if (!state.call || state.call.id !== event.id) return state;
      return { ...state, call: { ...state.call, muted: event.muted } };
    case 'call_cleared':
      if (!state.call || state.call.id !== event.id) return state;
      return { ...state, call: null };
    default:
      return state;
  }
}

/** Cabeçalho que a API4COM põe no INVITE de uma chamada originada pela API. */
export const INTEGRATED_CALL_HEADER = 'X-Api4comintegratedcall';

export function isIntegratedCallHeader(value: string | null | undefined): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

/** Número do outro lado a partir do `user` da URI SIP (só dígitos; vazio se anônimo). */
export function remoteNumberFromUri(user: string | null | undefined): string {
  return String(user ?? '').replace(/\D/g, '');
}

/** Segundos de conversa (só depois de atendida). */
export function callTalkSeconds(call: WebphoneCall | null, now: number): number {
  if (!call?.answeredAt) return 0;
  const end = call.endedAt ?? now;
  return Math.max(0, Math.floor((end - call.answeredAt) / 1000));
}

/** O webphone pode receber a perna do ramal agora? */
export function canReceiveCalls(state: WebphoneState): boolean {
  return state.registration === 'registered' && state.mic !== 'denied';
}

/**
 * Motivo para NÃO disparar `POST /calls` a partir desta aba, ou `null` se
 * pode ligar. Com o webphone desligado (`disabled`) o fluxo antigo (extensão)
 * continua valendo; com ele ligado mas ainda não pronto, a API4COM devolveria
 * 424 "user not registered" ou a chamada cairia por falta de microfone.
 */
export function dialingBlockReason(state: WebphoneState): string | null {
  switch (state.registration) {
    case 'disabled':
      return null;
    case 'registered':
      if (state.mic === 'denied') return 'Libere o microfone para o EnriqueceAI no navegador antes de ligar.';
      if (state.call && state.call.phase !== 'ended') return 'Já existe uma ligação em andamento nesta aba.';
      return null;
    case 'connecting':
      return 'O webphone ainda está conectando ao ramal. Aguarde o indicador ficar verde.';
    case 'disconnected':
      return 'O webphone perdeu a conexão com o ramal. Aguarde a reconexão ou recarregue a página.';
    case 'error':
      return `O webphone não conseguiu registrar o ramal${state.error ? ` (${state.error})` : ''}. Avise o gestor.`;
    default:
      return null;
  }
}
