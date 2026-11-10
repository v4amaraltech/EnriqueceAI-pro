// Contexto da ligação em andamento para o painel flutuante do webphone.
//
// O discador que chama `initiateCall` (fila de atividades, Power Dialer,
// detalhe do lead) sabe qual linha de `calls` nasceu (`callId`), o id na
// API4COM e o lead; o painel flutuante vive no layout e não recebe nada por
// props. Este store de módulo (observado com `useSyncExternalStore`) é a ponte:
// o discador publica o contexto ao ligar, o painel lê.
//
// O reducer é puro (testável); o store e os eventos de janela ficam no fim.

import { readPendingWebphoneNotes, writePendingWebphoneNotes } from './webphone-note-persistence';

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
  /**
   * Token da discagem desta aba. Casa a perna SIP com o POST /calls.
   * Null em contexto antigo, sem reserva.
   */
  dialToken: string | null;
}

/** De quem é o texto que está no campo, quando isso é conhecido. */
export interface WebphoneNotesAnchor {
  callId: string | null;
  leadId: string | null;
  dialToken: string | null;
  phone: string | null;
  leadName: string | null;
}

/**
 * Anotação que saiu da tela antes de ser gravada.
 * `callId` null significa que não há ligação para receber o texto: ele não é
 * enviado a lugar nenhum.
 */
export interface HeldWebphoneNotes {
  holdId: string;
  callId: string | null;
  leadId: string | null;
  dialToken: string | null;
  phone: string | null;
  leadName: string | null;
  notes: string;
  rev: number;
  saveError: string | null;
}

export interface WebphoneCallContextState {
  context: WebphoneCallContext | null;
  /** Anotações digitadas no painel flutuante durante/depois da ligação. */
  notes: string;
  /** Sobe a cada edição. Uma gravação antiga não substitui texto mais novo. */
  notesRev: number;
  notesAnchor: WebphoneNotesAnchor | null;
  /**
   * Notas que saíram da tela. A ligação nova zera o campo visível, mas não
   * apaga o texto. Sem `callId`, o texto fica só recuperável aqui.
   */
  heldNotes: HeldWebphoneNotes[];
  /** Revisão já enviada com desfecho. Uma nota isolada não passa por cima. */
  concludedRev: Record<string, number>;
  /** Falha do armazenamento local. Não promete sobreviver a um reload. */
  persistWarning: string | null;
  /** Aviso curto depois que uma nota isolada foi gravada de fato. */
  saveNotice: string | null;
}

export type WebphoneCallContextAction =
  | { type: 'set'; context: WebphoneCallContext; holdId: string }
  | { type: 'notes'; notes: string; anchor?: WebphoneNotesAnchor | null }
  | { type: 'release_owner'; callId: string }
  | { type: 'clear'; callId?: string }
  | { type: 'park_notes'; holdId: string }
  | { type: 'edit_held'; holdId: string; notes: string }
  | { type: 'retry_held'; holdId: string }
  | { type: 'held_result'; holdId: string; rev: number; ok: boolean; error?: string }
  | { type: 'note_concluded'; callId: string; rev: number }
  | { type: 'rehydrate'; notes: string; notesRev: number; notesAnchor: WebphoneNotesAnchor | null; heldNotes: HeldWebphoneNotes[] }
  | { type: 'persist_warning'; warning: string | null }
  | { type: 'ack_held_notes'; holdId: string; rev: number };

export const initialWebphoneCallContextState: WebphoneCallContextState = {
  context: null,
  notes: '',
  notesRev: 0,
  notesAnchor: null,
  heldNotes: [],
  concludedRev: {},
  persistWarning: null,
  saveNotice: null,
};

function anchorFromContext(context: WebphoneCallContext): WebphoneNotesAnchor {
  return {
    callId: context.callId,
    leadId: context.leadId,
    dialToken: context.dialToken,
    phone: context.phone,
    leadName: context.leadName,
  };
}

function currentAnchor(state: WebphoneCallContextState): WebphoneNotesAnchor {
  if (state.notesAnchor) return state.notesAnchor;
  if (state.context) return anchorFromContext(state.context);
  return { callId: null, leadId: null, dialToken: null, phone: null, leadName: null };
}

function sameCall(state: WebphoneCallContextState, next: WebphoneCallContext): boolean {
  if (state.context?.callId === next.callId) return true;
  if (state.context?.dialToken && state.context.dialToken === next.dialToken) return true;
  if (state.notesAnchor?.dialToken && state.notesAnchor.dialToken === next.dialToken) return true;
  return false;
}

function holdVisible(state: WebphoneCallContextState, holdId: string): HeldWebphoneNotes[] {
  const note = state.notes.trim();
  if (!note) return state.heldNotes;
  const anchor = currentAnchor(state);
  if (anchor.callId) {
    const index = state.heldNotes.findIndex((held) => held.callId === anchor.callId);
    if (index >= 0) {
      const previous = state.heldNotes[index];
      if (!previous || previous.notes === note) return state.heldNotes;
      const next = [...state.heldNotes];
      next[index] = { ...previous, notes: note, rev: previous.rev + 1, saveError: null, phone: anchor.phone, leadName: anchor.leadName, leadId: anchor.leadId, dialToken: anchor.dialToken };
      return next;
    }
  }
  return [
    ...state.heldNotes,
    {
      holdId,
      callId: anchor.callId,
      leadId: anchor.leadId,
      dialToken: anchor.dialToken,
      phone: anchor.phone,
      leadName: anchor.leadName,
      notes: note,
      rev: Math.max(1, state.notesRev),
      saveError: null,
    },
  ];
}

export function reduceWebphoneCallContext(
  state: WebphoneCallContextState,
  action: WebphoneCallContextAction,
): WebphoneCallContextState {
  switch (action.type) {
    case 'set': {
      const same = sameCall(state, action.context);
      const heldNotes = same
        ? state.heldNotes.filter((held) => held.callId !== action.context.callId)
        : holdVisible(state, action.holdId);
      const anchor = anchorFromContext(action.context);
      if (same && state.notesAnchor?.callId == null && state.notesAnchor?.dialToken && state.notesAnchor.dialToken === action.context.dialToken) {
        return { ...state, context: action.context, notesAnchor: anchor, heldNotes };
      }
      return {
        ...state,
        context: action.context,
        notes: same ? state.notes : '',
        notesRev: same ? state.notesRev : 0,
        notesAnchor: anchor,
        heldNotes,
        saveNotice: same ? state.saveNotice : null,
      };
    }
    case 'notes': {
      if (state.notes === action.notes && (action.anchor === undefined || action.anchor === state.notesAnchor)) return state;
      const notesRev = state.notes === action.notes ? state.notesRev : state.notesRev + 1;
      return {
        ...state,
        notes: action.notes,
        notesRev,
        notesAnchor: action.anchor === undefined ? state.notesAnchor : action.anchor,
        saveNotice: null,
      };
    }
    case 'release_owner':
      if (!state.context || state.context.callId !== action.callId || !state.context.ownerHandlesResult) return state;
      return { ...state, context: { ...state.context, ownerHandlesResult: false } };
    case 'clear': {
      if (!state.context) {
        if (!state.notes) return state;
        return state.heldNotes.length === 0 ? { ...initialWebphoneCallContextState, persistWarning: state.persistWarning } : { ...state, notes: '', notesRev: 0, notesAnchor: null };
      }
      if (action.callId && state.context.callId !== action.callId) return state;
      if (state.heldNotes.length === 0) return { ...initialWebphoneCallContextState, persistWarning: state.persistWarning };
      return { ...state, context: null, notes: '', notesRev: 0, notesAnchor: null };
    }
    case 'park_notes': {
      const heldNotes = holdVisible(state, action.holdId);
      if (heldNotes === state.heldNotes && !state.notes) return state;
      return { ...state, notes: '', notesRev: 0, notesAnchor: null, heldNotes };
    }
    case 'edit_held': {
      const index = state.heldNotes.findIndex((held) => held.holdId === action.holdId);
      const previous = index >= 0 ? state.heldNotes[index] : undefined;
      if (!previous || previous.notes === action.notes) return state;
      const next = [...state.heldNotes];
      next[index] = { ...previous, notes: action.notes, rev: previous.rev + 1, saveError: null };
      return { ...state, heldNotes: next, saveNotice: null };
    }
    case 'retry_held': {
      const index = state.heldNotes.findIndex((held) => held.holdId === action.holdId);
      const previous = index >= 0 ? state.heldNotes[index] : undefined;
      if (!previous?.saveError) return state;
      const next = [...state.heldNotes];
      next[index] = { ...previous, saveError: null };
      return { ...state, heldNotes: next };
    }
    case 'held_result': {
      const index = state.heldNotes.findIndex((held) => held.holdId === action.holdId);
      const previous = index >= 0 ? state.heldNotes[index] : undefined;
      if (!previous || previous.rev !== action.rev) return state;
      if (action.ok) {
        return {
          ...state,
          heldNotes: state.heldNotes.filter((held) => held.holdId !== action.holdId),
          saveNotice: 'Anotação gravada na ligação.',
        };
      }
      const next = [...state.heldNotes];
      next[index] = { ...previous, saveError: action.error ?? 'Não consegui gravar a anotação na ligação. Ela continua editável aqui.' };
      return { ...state, heldNotes: next, saveNotice: null };
    }
    case 'note_concluded': {
      const previous = state.concludedRev[action.callId] ?? 0;
      if (action.rev <= previous) return state;
      return { ...state, concludedRev: { ...state.concludedRev, [action.callId]: action.rev } };
    }
    case 'rehydrate': {
      if (state.notes.trim() || state.heldNotes.length > 0) return state;
      return {
        ...state,
        notes: action.notes,
        notesRev: action.notesRev,
        notesAnchor: action.notesAnchor,
        heldNotes: action.heldNotes,
      };
    }
    case 'persist_warning':
      return state.persistWarning === action.warning ? state : { ...state, persistWarning: action.warning };
    case 'ack_held_notes': {
      const current = state.heldNotes.find((held) => held.holdId === action.holdId);
      if (!current || current.rev !== action.rev) return state;
      return {
        ...state,
        heldNotes: state.heldNotes.filter((held) => held.holdId !== action.holdId),
        saveNotice: 'Anotação gravada na ligação.',
      };
    }
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
let holdSeq = 0;
let didHydrate = false;

function nextHoldId(): string {
  holdSeq += 1;
  return `hold-${holdSeq}`;
}

function rememberPendingNotes(): void {
  if (typeof window === 'undefined') return;
  const result = writePendingWebphoneNotes(window.localStorage, {
    notes: state.notes,
    notesRev: state.notesRev,
    notesAnchor: state.notesAnchor,
    heldNotes: state.heldNotes,
  });
  const warning = result.ok ? null : result.error;
  if (warning === state.persistWarning) return;
  state = reduceWebphoneCallContext(state, { type: 'persist_warning', warning });
}

function dispatch(action: WebphoneCallContextAction): void {
  const next = reduceWebphoneCallContext(state, action);
  if (next === state) return;
  state = next;
  if (action.type !== 'persist_warning') rememberPendingNotes();
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
export function setWebphoneCallContext(
  context: Omit<WebphoneCallContext, 'startedAt' | 'dialToken'> & { startedAt?: number; dialToken?: string | null },
): void {
  dispatch({
    type: 'set',
    holdId: nextHoldId(),
    context: { ...context, dialToken: context.dialToken ?? null, startedAt: context.startedAt ?? Date.now() },
  });
}

export function setWebphoneCallNotes(notes: string, anchor?: WebphoneNotesAnchor | null): void {
  dispatch({ type: 'notes', notes, anchor });
}

/** Tira o texto do campo sem apagá-lo. Usado quando não há callId para concluir. */
export function parkWebphoneCallNotes(): void {
  dispatch({ type: 'park_notes', holdId: nextHoldId() });
}

export function editHeldWebphoneNotes(holdId: string, notes: string): void {
  dispatch({ type: 'edit_held', holdId, notes });
}

export function retryHeldWebphoneNotes(holdId: string): void {
  dispatch({ type: 'retry_held', holdId });
}

export function reportHeldWebphoneNotes(holdId: string, rev: number, ok: boolean, error?: string): void {
  dispatch({ type: 'held_result', holdId, rev, ok, error });
}

/** O Concluir com desfecho ficou dono desta revisão. A nota isolada não regrava por cima. */
export function markWebphoneNotesConcluded(callId: string, rev: number): void {
  dispatch({ type: 'note_concluded', callId, rev });
}

/**
 * Revisão da nota que este envio representa. Texto igual ao rascunho conhecido
 * reutiliza a revisão; texto diferente fica acima dela. Uma gravação só de
 * nota com revisão menor não substitui esta. Não marca a nota como concluída:
 * se este envio falhar, o rascunho continua podendo ser gravado. Não inventa callId.
 */
export function notesRevisionForSubmit(callId: string, text: string): number {
  const trimmed = text.trim();
  const held = state.heldNotes.find((item) => item.callId === callId);
  const visible = state.notesAnchor?.callId === callId || state.context?.callId === callId;
  const current = held?.notes ?? (visible ? state.notes : '');
  const base = held?.rev ?? (visible ? state.notesRev : 0);
  return trimmed === current.trim() ? Math.max(base, trimmed ? 1 : 0) : base + 1;
}

/** Restaura rascunho e notas retidas depois de um reload. Não inventa callId. */
export function rehydrateWebphonePendingNotes(): void {
  if (didHydrate || typeof window === 'undefined') return;
  didHydrate = true;
  const saved = readPendingWebphoneNotes(window.localStorage);
  if (!saved) return;
  dispatch({ type: 'rehydrate', ...saved });
}

/** O discador dono desmontou no meio da ligação: o painel flutuante assume o resultado. */
export function releaseWebphoneCallOwner(callId: string): void {
  dispatch({ type: 'release_owner', callId });
}

/** Ligação concluída (ou descartada) por quem cuidava dela. Com `callId`, só limpa se for a mesma. */
export function clearWebphoneCallContext(callId?: string): void {
  dispatch({ type: 'clear', callId });
}

/** A anotação retida desta revisão foi gravada. Revisão mais nova não é apagada. */
export function ackHeldWebphoneNotes(holdId: string, rev: number): void {
  dispatch({ type: 'ack_held_notes', holdId, rev });
}

export function resetWebphoneCallContextForTests(): void {
  state = initialWebphoneCallContextState;
  holdSeq = 0;
  didHydrate = false;
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem('enriquece.webphone.pending-notes');
  }
  for (const l of listeners) l();
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
