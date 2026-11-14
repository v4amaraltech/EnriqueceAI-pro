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

/**
 * Ligações (callId) cujo Resultado já foi concluído ou fechado nesta aba, e
 * por qual modal. O outro dono (dock ou painel de atividades) não abre um
 * segundo Resultado para a mesma ligação depois que o primeiro fechou.
 */
const resolvedCallIds = new Map<string, symbol>();
const RESOLVED_LIMIT = 200;

/** Marca a ligação como resolvida por este modal (`by`). */
export function markCallResultResolved(callId: string | null | undefined, by: symbol): void {
  if (!callId || resolvedCallIds.has(callId)) return;
  resolvedCallIds.set(callId, by);
  if (resolvedCallIds.size > RESOLVED_LIMIT) {
    const oldest = resolvedCallIds.keys().next().value;
    if (oldest) resolvedCallIds.delete(oldest);
  }
}

/** Resolvida por OUTRO modal: este não deve abrir. */
export function isCallResultResolvedElsewhere(
  callId: string | null | undefined,
  me: symbol,
): boolean {
  if (!callId) return false;
  const by = resolvedCallIds.get(callId);
  return Boolean(by && by !== me);
}
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
  resolvedCallIds.clear();
  listeners.clear();
}
