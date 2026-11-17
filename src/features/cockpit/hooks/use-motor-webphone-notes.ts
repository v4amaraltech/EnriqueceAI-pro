'use client';

import { useEffect, useRef } from 'react';

import { toast } from 'sonner';

import { onWebphoneConcludeRequested } from '@/features/integrations/webphone/webphone-call-context';

import { useMotorCallNoteSaver, type MotorCallNoteSaver } from './use-motor-call-note-saver';

/**
 * O motor publica o contexto do webphone com `ownerHandlesResult: true` (o "dono" cuida do resultado), mas só o painel de
 * Atividades e o Power Dialer escutavam o "Concluir" do webphone: no Cockpit a nota digitada ficava "ainda não gravada".
 *
 * Aqui o Cockpit assina o pedido de conclusão e grava SÓ A NOTA da ligação do motor pelo gravador único
 * (`useMotorCallNoteSaver`, o mesmo do campo do painel do lead). Erro de gravação: avisa e NÃO apaga o texto (ele segue no
 * webphone e o estacionamento tenta de novo). Simulado: nada.
 */
export function useMotorWebphoneNotes({ live, callId, saver }: { live: boolean; callId: string | null; saver?: MotorCallNoteSaver }): void {
  const own = useMotorCallNoteSaver();
  const { save } = saver ?? own;
  // Ligações do motor vistas nesta tela (o SDR pode concluir depois de o motor já ter seguido para outro lead).
  const motorCalls = useRef(new Set<string>());

  useEffect(() => {
    if (callId) motorCalls.current.add(callId);
  }, [callId]);

  useEffect(() => {
    if (!live) return;
    return onWebphoneConcludeRequested((detail) => {
      const id = detail.callId;
      if (!motorCalls.current.has(id)) return; // ligação de outro discador
      if (!detail.notes.trim()) return;
      void save(id, detail.notes, detail.durationSeconds).then((r) => {
        if (!r.ok) toast.error(r.error);
      });
    });
  }, [live, save]);
}
