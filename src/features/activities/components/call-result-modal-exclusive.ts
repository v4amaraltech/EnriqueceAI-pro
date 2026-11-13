'use client';

/**
 * Garante um único "Resultado da Ligação" visível por vez nesta aba.
 *
 * O painel de atividades e o painel flutuante do webphone podem abrir o
 * mesmo modal no mesmo hangup, com dados diferentes: um usa o tempo da
 * perna do ramal ("Atendida, 00:06"), o outro usa o desfecho já gravado
 * no servidor ("Não atendida, 00:00"). Fica o de maior pontuação (o que
 * já tem o desfecho do sistema).
 */
import { useEffect, useRef, useState } from 'react';

export function resultModalScore(input: {
  alreadyFilled?: boolean;
  leadAnswerKnown?: boolean;
}): number {
  if (input.alreadyFilled) return 3;
  if (input.leadAnswerKnown) return 2;
  return 1;
}

interface Claim {
  owner: symbol;
  score: number;
}

let current: Claim | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  // Fora da pintura atual: o segundo modal não pode dar setState no primeiro durante o render.
  queueMicrotask(() => {
    for (const listener of listeners) listener();
  });
}

export function claimCallResultModal(owner: symbol, score: number): boolean {
  if (!current || current.owner === owner || score > current.score) {
    const changed = current?.owner !== owner || current.score !== score;
    current = { owner, score };
    if (changed) notify();
    return true;
  }
  return current.owner === owner;
}

export function releaseCallResultModal(owner: symbol): void {
  if (current?.owner !== owner) return;
  current = null;
  notify();
}

/**
 * `open` pedido pelo dono, com pontuação. Só um retorna true por vez.
 * A primeira pintura já decide (os testes de um único modal não precisam esperar).
 */
export function useExclusiveCallResultOpen(open: boolean, score: number): boolean {
  const ownerRef = useRef(Symbol('call-result-modal'));
  const owner = ownerRef.current;
  const [shown, setShown] = useState(() => (open ? claimCallResultModal(owner, score) : false));

  useEffect(() => {
    const sync = () => setShown(open && current?.owner === owner);
    listeners.add(sync);
    if (open) {
      setShown(claimCallResultModal(owner, score));
    } else {
      releaseCallResultModal(owner);
      setShown(false);
    }
    return () => {
      listeners.delete(sync);
      releaseCallResultModal(owner);
    };
  }, [open, score, owner]);

  if (!open) return false;
  return shown || current?.owner === owner;
}

/** Só para testes. */
export function resetCallResultModalExclusive(): void {
  current = null;
  listeners.clear();
}
