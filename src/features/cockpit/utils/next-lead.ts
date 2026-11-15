const DAY_MS = 86_400_000;

export const REPLY_WINDOW_MS = 7 * DAY_MS;
export const NO_SHOW_WINDOW_MS = 14 * DAY_MS;
export const ENGAGED_WINDOW_MS = 7 * DAY_MS;

export interface NextLeadCandidate {
  id: string;
  updatedAt: string;
  noShowAt: string | null;
}

export interface NextLeadInteraction {
  leadId: string;
  type: string;
  at: string;
}

/** 4 resposta (7d), 3 no-show (14d), 2 abertura/clique (7d), 1 o restante. */
export function leadSignalScore(
  candidate: Pick<NextLeadCandidate, 'id' | 'noShowAt'>,
  interactions: readonly NextLeadInteraction[],
  now: Date,
): number {
  const age = (iso: string) => now.getTime() - new Date(iso).getTime();
  const own = interactions.filter((i) => i.leadId === candidate.id);
  if (own.some((i) => i.type === 'replied' && age(i.at) <= REPLY_WINDOW_MS)) return 4;
  if (candidate.noShowAt && age(candidate.noShowAt) <= NO_SHOW_WINDOW_MS) return 3;
  if (own.some((i) => (i.type === 'clicked' || i.type === 'opened') && age(i.at) <= ENGAGED_WINDOW_MS)) return 2;
  return 1;
}

/**
 * Escolhe o próximo lead da carteira por regra fixa: resposta recente, depois
 * no-show recente, depois interação recente, depois o resto. Empate pelo lead
 * atualizado mais recentemente. Sem candidatos devolve null.
 */
export function pickNextLead(input: {
  candidates: NextLeadCandidate[];
  interactions: NextLeadInteraction[];
  now: Date;
}): string | null {
  const { candidates, interactions, now } = input;

  let best: { id: string; score: number; updatedAt: string } | null = null;
  for (const c of candidates) {
    const s = leadSignalScore(c, interactions, now);
    if (!best || s > best.score || (s === best.score && c.updatedAt.localeCompare(best.updatedAt) > 0)) {
      best = { id: c.id, score: s, updatedAt: c.updatedAt };
    }
  }
  return best?.id ?? null;
}
