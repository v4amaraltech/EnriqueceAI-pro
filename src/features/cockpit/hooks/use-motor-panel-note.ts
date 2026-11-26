'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { toast } from 'sonner';

import { callNoteKey, readCallNote, writeCallNote } from '../utils/call-note-draft';
import { appendNoteLine } from '../utils/referral';

import type { MotorCallNoteSaver } from './use-motor-call-note-saver';

/**
 * Estado do campo "Anotações" do painel do lead (item 5: é a anotação que VALE na discagem e grava na ligação do lead).
 *  - 'idle'      nada pendente
 *  - 'simulated' simulado: nada é gravado
 *  - 'waiting'   há texto e a ligação do lead ainda não existe (discando): grava assim que o callId existir
 *  - 'no-call'   há texto, a ligação NÃO existe e já não está discando (POST recusado/pausa): o texto fica aqui, não gravado
 *  - 'saving' / 'saved' / 'error'
 */
export type MotorNoteStatus = { kind: 'idle' | 'simulated' | 'waiting' | 'no-call' | 'saving' | 'saved' } | { kind: 'error'; message: string };

export interface MotorPanelNote {
  value: string;
  onChange: (value: string) => void;
  /** Ao sair do campo grava. */
  onBlur: () => void;
  /** Grava agora (antes de uma ação final do lead). Não espera: dispara e segue. */
  flush: () => void;
  retry: () => void;
  /** Acrescenta uma linha (sem repetir) e grava. Ignora lead que não é o do painel. Devolve o texto completo. */
  append: (forLeadId: string, line: string) => string;
  /** Texto atual do campo (sempre o mais recente, mesmo em closure velha). Usado como observação do "Ligar depois". */
  getValue: () => string;
  status: MotorNoteStatus;
}

interface Snapshot {
  live: boolean;
  leadId: string | null;
  leadName: string;
  callId: string | null;
  text: string;
}

interface Input {
  live: boolean;
  /** Lead que está no painel (null = nenhum). */
  leadId: string | null;
  leadName: string;
  /** `callId` do motor (pode ser o da ligação ANTERIOR enquanto o lead novo ainda está discando). */
  engineCallId: string | null;
  /** O motor está discando ESTE lead agora (a ligação ainda não nasceu). */
  dialing: boolean;
  /** O painel está ativo (em ligação ou pausa que mantém o painel). Ao deixar de estar, o texto pendente é gravado. */
  active: boolean;
  saver: MotorCallNoteSaver;
}

/**
 * Regras (as mais simples e seguras):
 *  - Digitar só atualiza o estado e o rascunho local (sessionStorage); NENHUMA Server Action por tecla.
 *  - Grava na ligação do lead: ao SAIR do campo (blur), antes de uma ação final (flush), quando o callId passa a existir,
 *    ao deixar de estar em ligação (parar a discagem) e ao TROCAR de lead/desmontar (grava na ligação ANTERIOR e avisa).
 *  - O campo só muda de texto quando o LEAD muda; nunca é esvaziado com o SDR digitando.
 *  - Erro: o texto fica e dá para tentar de novo. Sem callId o texto fica no estado (e no rascunho).
 *  - Ligação do lead: `callId` do motor só vale se foi visto pela 1ª vez com ESTE lead no painel (durante `dialing` o
 *    callId do estado é o da ligação anterior).
 */
export function useMotorPanelNote({ live, leadId, leadName, engineCallId, dialing, active, saver }: Input): MotorPanelNote {
  const [draft, setDraft] = useState<{ leadId: string | null; value: string }>(() => ({ leadId, value: leadId ? readCallNote(callNoteKey('motor', leadId)) : '' }));
  if (draft.leadId !== leadId) setDraft({ leadId, value: leadId ? readCallNote(callNoteKey('motor', leadId)) : '' });
  const text = draft.leadId === leadId ? draft.value : leadId ? readCallNote(callNoteKey('motor', leadId)) : '';

  // callId → lead da 1ª vez que apareceu.
  const [callLead, setCallLead] = useState<Record<string, string>>({});
  if (engineCallId && leadId && !(engineCallId in callLead)) setCallLead({ ...callLead, [engineCallId]: leadId });
  const callId = engineCallId && leadId && (callLead[engineCallId] ?? leadId) === leadId ? engineCallId : null;

  const [statusState, setStatusState] = useState<{ leadId: string | null; status: MotorNoteStatus }>({ leadId, status: { kind: 'idle' } });

  const latest = useRef<Snapshot>({ live, leadId, leadName, callId, text });
  // Último texto GRAVADO por lead (qualquer ligação): o mesmo texto não é regravado numa 2ª ligação do lead na mesma tela.
  const savedForLead = useRef(new Map<string, string>());
  useEffect(() => {
    latest.current = { live, leadId, leadName, callId, text };
  });

  const setStatusFor = useCallback((forLead: string | null, status: MotorNoteStatus) => {
    setStatusState({ leadId: forLead, status });
  }, []);

  /** Grava o texto do snapshot na ligação dele. `notify`: lead que saiu do painel (avisa por toast). */
  const persist = useCallback(
    async (snap: Snapshot, notify: boolean) => {
      const value = snap.text.trim();
      if (!snap.live || !value || !snap.callId) return;
      if (saver.isSaved(snap.callId, value)) return;
      // Texto que já foi gravado numa ligação anterior deste lead (rascunho velho que reabriu): não vai para a ligação nova.
      if (snap.leadId && savedForLead.current.get(snap.leadId) === value) return;
      if (!notify) setStatusFor(snap.leadId, { kind: 'saving' });
      const r = await saver.save(snap.callId, value);
      if (r.ok && snap.leadId) {
        savedForLead.current.set(snap.leadId, value);
        // Gravou: o rascunho (sessionStorage) sai, para não reabrir nem regravar na ligação seguinte. Só se ainda for ESSE texto
        // (digitou mais durante a gravação? o rascunho novo fica). Com erro o rascunho permanece.
        const key = callNoteKey('motor', snap.leadId);
        if (readCallNote(key).trim() === value) writeCallNote(key, '');
      }
      if (notify) {
        if (r.ok) toast.info(`Anotação guardada na ligação de ${snap.leadName}`);
        else toast.error(`Não consegui guardar a anotação da ligação de ${snap.leadName}. O texto continua guardado neste navegador.`);
        return;
      }
      setStatusFor(snap.leadId, r.ok ? { kind: 'saved' } : { kind: 'error', message: r.error });
    },
    [saver, setStatusFor],
  );

  const flush = useCallback(() => {
    void persist(latest.current, false);
  }, [persist]);

  // Texto digitado enquanto discava: grava assim que o callId do lead existe.
  useEffect(() => {
    if (callId && latest.current.text.trim()) void persist(latest.current, false);
  }, [callId, persist]);

  // Trocou de lead (ou a tela saiu): grava o texto pendente na ligação ANTERIOR e avisa.
  useEffect(
    () => () => {
      const snap = latest.current;
      if (!snap.leadId) return;
      const leaving = snap.leadId;
      // Saiu do painel: depois da gravação o lead "esquece" o último texto gravado (uma ligação futura pode repetir a frase).
      void persist(snap, true).finally(() => savedForLead.current.delete(leaving));
    },
    [leadId, persist],
  );

  // Parou a discagem / deixou de estar em ligação: não perde o texto.
  useEffect(() => {
    if (!active && latest.current.text.trim()) void persist(latest.current, false);
  }, [active, persist]);

  function onChange(value: string) {
    setDraft({ leadId, value });
    if (leadId) writeCallNote(callNoteKey('motor', leadId), value);
    setStatusFor(leadId, { kind: 'idle' });
  }

  let status: MotorNoteStatus = statusState.leadId === leadId ? statusState.status : { kind: 'idle' };
  if (!live && text.trim()) status = { kind: 'simulated' };
  else if (live && text.trim() && !callId && status.kind !== 'error') status = dialing ? { kind: 'waiting' } : { kind: 'no-call' };
  else if (live && callId && text.trim() && status.kind === 'idle' && saver.isSaved(callId, text)) status = { kind: 'saved' };

  const getValue = useCallback(() => latest.current.text, []);
  const append = useCallback(
    (forLeadId: string, line: string) => {
      const snap = latest.current;
      // O painel já é de outro lead: não escreve nele.
      if (snap.leadId !== forLeadId) return line;
      const next = appendNoteLine(snap.text, line);
      latest.current = { ...snap, text: next };
      setDraft({ leadId: forLeadId, value: next });
      writeCallNote(callNoteKey('motor', forLeadId), next);
      setStatusFor(forLeadId, { kind: 'idle' });
      void persist(latest.current, false);
      return next;
    },
    [persist, setStatusFor],
  );
  return { value: text, onChange, onBlur: flush, flush, retry: flush, getValue, append, status };
}
