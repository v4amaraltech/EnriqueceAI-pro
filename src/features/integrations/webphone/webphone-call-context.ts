// Contexto da ligação em andamento para o painel flutuante do webphone.
//
// O discador que chama `initiateCall` (fila de atividades, Power Dialer,
// detalhe do lead) sabe qual linha de `calls` nasceu (`callId`), o id na
// API4COM e o lead; o painel flutuante vive no layout e não recebe nada por
// props. Este store de módulo (observado com `useSyncExternalStore`) é a ponte:
// o discador publica o contexto ao ligar, o painel lê.
//
// O reducer é puro (testável); o store e os eventos de janela ficam no fim.

export interface WebphoneCallContext {
  /** `calls.id` da ligação em andamento. */
  callId: string;
  /** Id da chamada na API4COM (para o `hangupApi4ComCall` de garantia). */
  providerCallId: string | null;
  leadId: string | null;
  leadName: string | null;
  /** Número discado, como o SDR vê. */
  phone: string | null;
  /**
   * O discador que iniciou tem o próprio modal de resultado (`CallResultModal`)
   * e ainda está montado: o painel flutuante só pede a ele para concluir, em
   * vez de abrir um segundo modal. Vira `false` quando o discador desmonta no
   * meio da ligação (o SDR trocou de tela) — aí o painel assume o resultado.
   */
  ownerHandlesResult: boolean;
  startedAt: number;
}

export interface WebphoneCallContextState {
  context: WebphoneCallContext | null;
  /** Anotações digitadas no painel flutuante durante/depois da ligação. */
  notes: string;
}

export type WebphoneCallContextAction =
  | { type: 'set'; context: WebphoneCallContext }
  | { type: 'notes'; notes: string }
  | { type: 'release_owner'; callId: string }
  | { type: 'clear'; callId?: string };

export const initialWebphoneCallContextState: WebphoneCallContextState = { context: null, notes: '' };

export function reduceWebphoneCallContext(
  state: WebphoneCallContextState,
  action: WebphoneCallContextAction,
): WebphoneCallContextState {
  switch (action.type) {
    case 'set':
      // Ligação nova: as anotações da anterior não vazam.
      return { context: action.context, notes: state.context?.callId === action.context.callId ? state.notes : '' };
    case 'notes':
      return state.notes === action.notes ? state : { ...state, notes: action.notes };
    case 'release_owner':
      if (!state.context || state.context.callId !== action.callId || !state.context.ownerHandlesResult) return state;
      return { ...state, context: { ...state.context, ownerHandlesResult: false } };
    case 'clear':
      if (!state.context) return state.notes ? { ...state, notes: '' } : state;
      if (action.callId && state.context.callId !== action.callId) return state;
      return initialWebphoneCallContextState;
    default:
      return state;
  }
}

/**
 * Janela de tolerância para casar contexto e ligação: o contexto nasce quando
 * `POST /calls` responde, o que acontece DEPOIS do INVITE chegar ao ramal.
 */
export const CONTEXT_MATCH_WINDOW_MS = 60_000;

/**
 * O contexto publicado é desta ligação? Um contexto esquecido (ligação do
 * detalhe do lead que o SDR nunca concluiu) não pode grudar numa chamada
 * recebida minutos depois: só casa se nasceu no máximo 60 s ANTES do INVITE.
 */
export function contextMatchesCall(
  context: WebphoneCallContext | null | undefined,
  call: { startedAt: number } | null | undefined,
): context is WebphoneCallContext {
  if (!context || !call) return false;
  return context.startedAt >= call.startedAt - CONTEXT_MATCH_WINDOW_MS;
}

// ---------------------------------------------------------------------------
// Store de módulo (uma aba = um contexto)
// ---------------------------------------------------------------------------

let state: WebphoneCallContextState = initialWebphoneCallContextState;
const listeners = new Set<() => void>();

function dispatch(action: WebphoneCallContextAction): void {
  const next = reduceWebphoneCallContext(state, action);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function getWebphoneCallContextState(): WebphoneCallContextState {
  return state;
}

export function subscribeWebphoneCallContext(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Publicar o contexto logo depois de `initiateCall` devolver `callId`. */
export function setWebphoneCallContext(context: Omit<WebphoneCallContext, 'startedAt'> & { startedAt?: number }): void {
  dispatch({ type: 'set', context: { ...context, startedAt: context.startedAt ?? Date.now() } });
}

export function setWebphoneCallNotes(notes: string): void {
  dispatch({ type: 'notes', notes });
}

/** O discador dono desmontou no meio da ligação: o painel flutuante assume o resultado. */
export function releaseWebphoneCallOwner(callId: string): void {
  dispatch({ type: 'release_owner', callId });
}

/** Ligação concluída (ou descartada) por quem cuidava dela. Com `callId`, só limpa se for a mesma. */
export function clearWebphoneCallContext(callId?: string): void {
  dispatch({ type: 'clear', callId });
}

// ---------------------------------------------------------------------------
// Pedido de conclusão: painel flutuante → discador dono
// ---------------------------------------------------------------------------

export const WEBPHONE_CONCLUDE_REQUESTED_EVENT = 'webphone:conclude-requested';

export interface WebphoneConcludeRequest {
  callId: string;
  /** Segundos de conversa medidos pelo webphone (0 quando não atendeu). */
  durationSeconds: number;
  notes: string;
}

/** O SDR clicou em "Concluir" no painel flutuante: o discador dono abre o seu modal de resultado. */
export function requestWebphoneConclude(detail: WebphoneConcludeRequest): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<WebphoneConcludeRequest>(WEBPHONE_CONCLUDE_REQUESTED_EVENT, { detail }));
}

/** Assinatura para o discador dono. Devolve a função de cancelar. */
export function onWebphoneConcludeRequested(handler: (detail: WebphoneConcludeRequest) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<WebphoneConcludeRequest>).detail;
    if (detail && typeof detail.callId === 'string') handler(detail);
  };
  window.addEventListener(WEBPHONE_CONCLUDE_REQUESTED_EVENT, listener);
  return () => window.removeEventListener(WEBPHONE_CONCLUDE_REQUESTED_EVENT, listener);
}
