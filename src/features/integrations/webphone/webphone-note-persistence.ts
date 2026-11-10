import type { HeldWebphoneNotes, WebphoneNotesAnchor } from './webphone-call-context';

export const WEBPHONE_PENDING_NOTES_KEY = 'enriquece.webphone.pending-notes';

export const NOTE_PERSIST_FAILURE =
  'Não consegui guardar a anotação neste navegador. Se recarregar a página, o texto que ainda não foi gravado na ligação se perde.';

export interface PersistedWebphoneNotes {
  notes: string;
  notesRev: number;
  notesAnchor: WebphoneNotesAnchor | null;
  heldNotes: HeldWebphoneNotes[];
}

function isAnchor(value: unknown): value is WebphoneNotesAnchor {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    (row.callId === null || typeof row.callId === 'string') &&
    (row.leadId === null || typeof row.leadId === 'string') &&
    (row.dialToken === null || typeof row.dialToken === 'string') &&
    (row.phone === null || typeof row.phone === 'string') &&
    (row.leadName === null || typeof row.leadName === 'string')
  );
}

function isHold(value: unknown): value is HeldWebphoneNotes {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.holdId === 'string' &&
    (row.callId === null || typeof row.callId === 'string') &&
    (row.leadId === null || typeof row.leadId === 'string') &&
    (row.dialToken === null || typeof row.dialToken === 'string') &&
    (row.phone === null || typeof row.phone === 'string') &&
    (row.leadName === null || typeof row.leadName === 'string') &&
    typeof row.notes === 'string' &&
    typeof row.rev === 'number' &&
    (row.saveError === null || typeof row.saveError === 'string')
  );
}

export function readPendingWebphoneNotes(storage: Pick<Storage, 'getItem'>): PersistedWebphoneNotes | null {
  try {
    const raw = storage.getItem(WEBPHONE_PENDING_NOTES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const row = parsed as Record<string, unknown>;
    const heldNotes = Array.isArray(row.heldNotes) ? row.heldNotes.filter(isHold) : [];
    const notes = typeof row.notes === 'string' ? row.notes : '';
    const notesAnchor = row.notesAnchor == null ? null : isAnchor(row.notesAnchor) ? row.notesAnchor : null;
    const notesRev = typeof row.notesRev === 'number' ? row.notesRev : 0;
    if (!notes.trim() && heldNotes.length === 0) return null;
    return { notes, notesRev, notesAnchor, heldNotes };
  } catch {
    return null;
  }
}

export function writePendingWebphoneNotes(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  payload: PersistedWebphoneNotes,
): { ok: true } | { ok: false; error: string } {
  try {
    if (!payload.notes.trim() && payload.heldNotes.length === 0) {
      storage.removeItem(WEBPHONE_PENDING_NOTES_KEY);
      return { ok: true };
    }
    storage.setItem(WEBPHONE_PENDING_NOTES_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, error: NOTE_PERSIST_FAILURE };
  }
}
