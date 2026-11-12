// Estado do webphone no navegador. Módulo PURO (testável sem JsSIP/DOM).
//
// O cliente JsSIP (`webphone-client.ts`) traduz os eventos do SIP para
// `WebphoneEvent` e este reducer mantém um único estado observável pela UI.

import type { WebphoneAudioStats } from './webphone-audio-stats';
import { MIC_MESSAGES, type MicPermission } from './webphone-mic';

export type { MicPermission } from './webphone-mic';

export type WebphoneRegistration = 'disabled' | 'connecting' | 'registered' | 'disconnected' | 'error';
export type WebphoneCallPhase = 'ringing' | 'in-call' | 'ended';
/**
 * Disputa do ramal com outra instância (a API4COM é singleton por ramal).
 * - `other_tab`: outra aba deste navegador segura o ramal; esta não registrou.
 * - `lost_to_other`: estava registrado e o registro caiu sem ter sido pedido
 *   aqui (outro navegador ou a extensão da API4COM pode ter assumido).
 *
 * NÃO é representado por `registration: 'disabled'`: `disabled` libera a
 * discagem pelo fluxo da extensão e o `POST /calls` desta aba tomaria 424.
 */
export type WebphoneSessionConflict = 'other_tab' | 'lost_to_other';

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
  /** Último resumo de `getStats()` da conexão WebRTC (bloco 3); null até a mídia fluir. */
  audioStats: WebphoneAudioStats | null;
  /** Discagem desta aba que originou o INVITE, quando deu para correlacionar. */
  dialToken?: string | null;
}

export interface WebphoneState {
  registration: WebphoneRegistration;
  error: string | null;
  mic: MicPermission;
  sessionConflict: WebphoneSessionConflict | null;
  call: WebphoneCall | null;
}

export type WebphoneEvent =
  | { type: 'disabled' }
  | { type: 'connecting' }
  | { type: 'registered' }
  | { type: 'unregistered' }
  | { type: 'disconnected'; error?: string }
  | { type: 'registration_failed'; cause: string }
  | { type: 'mic'; permission: MicPermission }
  | { type: 'session_conflict'; conflict: WebphoneSessionConflict | null }
  | { type: 'call_new'; id: string; remoteNumber: string; direction: 'incoming' | 'outgoing'; integrated: boolean; at: number; dialToken?: string | null }
  | { type: 'call_accepted'; id: string; at: number }
  | { type: 'call_ended'; id: string; at: number; cause: string | null }
  | { type: 'call_muted'; id: string; muted: boolean }
  | { type: 'call_stats'; id: string; stats: WebphoneAudioStats }
  | { type: 'call_cleared'; id: string };

export const initialWebphoneState: WebphoneState = {
  registration: 'disabled',
  error: null,
  mic: 'unknown',
  sessionConflict: null,
  call: null,
};

// Causas do JsSIP que são de rede (WebSocket caiu / sem resposta), e não de
// outra instância assumindo o ramal. A recuperação do WebSocket cuida delas.
const NETWORK_REGISTRATION_CAUSES = new Set(['Connection Error', 'Request Timeout']);

export function reduceWebphone(state: WebphoneState, event: WebphoneEvent): WebphoneState {
  switch (event.type) {
    case 'disabled':
      return { ...initialWebphoneState, mic: state.mic };
    case 'connecting':
      return { ...state, registration: 'connecting', error: null };
    case 'registered':
      // Registrou de novo sozinho (ou pelo Reconectar): o ramal é desta aba.
      return { ...state, registration: 'registered', error: null, sessionConflict: null };
    case 'unregistered':
      // Queda de WebSocket chega como `disconnected` ANTES do `unregistered`,
      // então só um `unregistered` vindo direto de `registered` é perda do
      // ramal para outra instância. O conflito já marcado nunca é apagado aqui.
      return {
        ...state,
        registration: state.registration === 'error' ? 'error' : 'disconnected',
        sessionConflict: state.registration === 'registered' ? 'lost_to_other' : state.sessionConflict,
      };
    case 'disconnected':
      return { ...state, registration: 'disconnected', error: event.error ?? state.error };
    case 'registration_failed':
      return {
        ...state,
        registration: 'error',
        error: `Registro SIP recusado (${event.cause})`,
        sessionConflict:
          state.registration === 'registered' && !NETWORK_REGISTRATION_CAUSES.has(event.cause)
            ? 'lost_to_other'
            : state.sessionConflict,
      };
    case 'mic':
      return state.mic === event.permission ? state : { ...state, mic: event.permission };
    case 'session_conflict':
      return state.sessionConflict === event.conflict ? state : { ...state, sessionConflict: event.conflict };
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
          audioStats: null,
          dialToken: event.dialToken ?? null,
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
    case 'call_stats':
      if (!state.call || state.call.id !== event.id) return state;
      return { ...state, call: { ...state.call, audioStats: event.stats } };
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

/**
 * O webphone pode receber a perna do ramal agora? Exige o microfone CONCEDIDO
 * (não basta "não negado"): sem ele o INVITE não é atendido e a ligação do
 * Power Dialer ficaria sem áudio.
 */
export function canReceiveCalls(state: WebphoneState): boolean {
  return state.registration === 'registered' && state.mic === 'granted' && !state.sessionConflict;
}

export const SESSION_CONFLICT_MESSAGES: Record<WebphoneSessionConflict, string> = {
  other_tab: 'O ramal está em uso em outra aba. Clique em Usar nesta aba para assumir.',
  lost_to_other:
    'O ramal foi desconectado. Outra aba, outro navegador ou a extensão da API4COM pode estar usando este ramal. Clique em Reconectar para usar aqui.',
};

/** Mensagem do microfone que impede ligar, ou null se está concedido. */
export function micBlockMessage(mic: MicPermission): string | null {
  return mic === 'granted' ? null : MIC_MESSAGES[mic];
}

/**
 * Motivo para NÃO disparar `POST /calls` a partir desta aba, ou `null` se
 * pode ligar. Com o webphone desligado (`disabled`) o fluxo antigo (extensão)
 * continua valendo; com ele ligado mas ainda não pronto, a API4COM devolveria
 * 424 "user not registered" ou a chamada cairia por falta de microfone.
 */
export function dialingBlockReason(state: WebphoneState): string | null {
  // Antes do `disabled`: a aba que perdeu para outra fica sem UA, mas não pode
  // cair no fluxo da extensão.
  if (state.sessionConflict) return SESSION_CONFLICT_MESSAGES[state.sessionConflict];
  switch (state.registration) {
    case 'disabled':
      return null;
    case 'registered':
      if (state.call && state.call.phase !== 'ended') return 'Já existe uma ligação em andamento nesta aba.';
      return micBlockMessage(state.mic);
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

/**
 * Algo impede ligar e o pill precisa ficar na tela (com o botão para resolver).
 * O microfone só conta com o webphone ligado nesta aba: com `disabled` sem
 * conflito o gestor não liberou o webphone e o fluxo é o da extensão.
 */
export function webphoneIdleProblem(state: WebphoneState): boolean {
  return state.registration === 'error' || webphoneIdleNeedsAction(state);
}

/** O SDR precisa clicar em algo (ativar microfone, usar nesta aba, reconectar). */
export function webphoneIdleNeedsAction(state: WebphoneState): boolean {
  if (state.sessionConflict) return true;
  return state.registration !== 'disabled' && state.mic !== 'granted';
}
