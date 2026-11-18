'use client';

import { useCallback, useMemo, useRef } from 'react';

import { classifyWebphoneCall } from '@/features/calls/actions/classify-webphone-call';
import { markWebphoneNotesConcluded, notesRevisionForSubmit } from '@/features/integrations/webphone/webphone-call-context';

export type NoteSaveResult = { ok: true } | { ok: false; error: string };

const STALE_NOTE_ERROR = 'Esta nota não substituiu uma anotação mais recente da mesma ligação. O texto continua aqui.';
const GENERIC_ERROR = 'Não consegui gravar a anotação da ligação.';

/**
 * Caminho ÚNICO de gravar a anotação numa ligação do motor (item 4: Concluir do webphone; item 5: campo do painel do lead).
 * `classifyWebphoneCall` SÓ com `notes` (sem `sdrOutcome`): nunca toca no desfecho (a guarda anti-sobrescrita do #655
 * segue valendo) nem avança cadência. A revisão vem de `notesRevisionForSubmit` e, depois de gravar, é marcada como
 * concluída para a nota retida pelo estacionamento do webphone não ser regravada. Mesmo texto no mesmo callId não regrava
 * (a reserva é feita antes do await: dois pedidos seguidos gravam uma vez). Erro: nada fica marcado e dá para tentar de novo.
 */
export function useMotorCallNoteSaver() {
  const savedText = useRef(new Map<string, string>());

  /** Este texto já foi gravado (ou está sendo) nesta ligação? */
  const isSaved = useCallback((callId: string, text: string) => savedText.current.get(callId) === text.trim(), []);

  const save = useCallback(async (callId: string, rawText: string, durationSeconds = 0): Promise<NoteSaveResult> => {
    const text = rawText.trim();
    if (!text) return { ok: true };
    if (savedText.current.get(callId) === text) return { ok: true };
    const notesRev = notesRevisionForSubmit(callId, text);
    savedText.current.set(callId, text);
    const undo = () => {
      if (savedText.current.get(callId) === text) savedText.current.delete(callId);
    };
    try {
      const r = await classifyWebphoneCall({ callId, clientDurationSeconds: Math.max(0, Math.round(durationSeconds || 0)), notes: text, notesRev });
      if (!r.success) {
        undo();
        return { ok: false, error: r.error || GENERIC_ERROR };
      }
      if (r.data.notesApplied === false) {
        undo();
        return { ok: false, error: STALE_NOTE_ERROR };
      }
      markWebphoneNotesConcluded(callId, notesRev);
      return { ok: true };
    } catch {
      undo();
      return { ok: false, error: GENERIC_ERROR };
    }
  }, []);

  // Objeto ESTÁVEL: quem o usa em dependências de efeito não pode re-disparar a cada render.
  return useMemo(() => ({ save, isSaved }), [save, isSaved]);
}

export type MotorCallNoteSaver = ReturnType<typeof useMotorCallNoteSaver>;
