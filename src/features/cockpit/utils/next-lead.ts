const DAY_MS = 86_400_000;
const REPLY_WINDOW_DAYS = 7;
const NO_SHOW_WINDOW_DAYS = 14;
const ENGAGED_WINDOW_DAYS = 7;

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
  const age = (iso: string) => now.getTime() - new Date(iso).getTime();

  const score = (c: NextLeadCandidate): number => {
    const own = interactions.filter((i) => i.leadId === c.id);
    if (own.some((i) => i.type === 'replied' && age(i.at) <= REPLY_WINDOW_DAYS * DAY_MS)) return 4;
    if (c.noShowAt && age(c.noShowAt) <= NO_SHOW_WINDOW_DAYS * DAY_MS) return 3;
    if (own.some((i) => (i.type === 'clicked' || i.type === 'opened') && age(i.at) <= ENGAGED_WINDOW_DAYS * DAY_MS)) return 2;
    return 1;
  };

  let best: { id: string; score: number; updatedAt: string } | null = null;
  for (const c of candidates) {
    const s = score(c);
    if (!best || s > best.score || (s === best.score && c.updatedAt.localeCompare(best.updatedAt) > 0)) {
      best = { id: c.id, score: s, updatedAt: c.updatedAt };
    }
  }
  return best?.id ?? null;
}
