/**
 * SAO (Oportunidade Aceita por Vendas) por lead, a partir das respostas do
 * closer em `closer_feedback_requests`.
 *
 * Regra: para cada lead vale a resposta MAIS RECENTE (`responded_at`) entre as
 * que preencheram a pergunta "Qualificada / Não qualificada"
 * (`oportunidade_qualificada` não nulo). Linhas sem resposta ou sem a pergunta
 * (no-show, remarcada, histórico anterior a 09/set/2026) são ignoradas — um
 * lead sem nenhuma resposta válida NÃO entra no mapa (ausente ≠ "não
 * qualificada"; quem quiser contar "sem avaliação" testa `has()`).
 *
 * Reatribuição de closer cria um 2º request no mesmo lead (o antigo fica sem
 * resposta) e co-closing pode gerar 2 respostas legítimas — por isso "mais
 * recente" e não "primeira".
 */
export interface SaoFeedbackRow {
  lead_id: string;
  oportunidade_qualificada: boolean | null;
  responded_at: string | null;
}

export function latestSaoByLead(rows: readonly SaoFeedbackRow[]): Map<string, boolean> {
  const latestAt = new Map<string, number>();
  const result = new Map<string, boolean>();

  for (const row of rows) {
    if (row.responded_at === null || row.oportunidade_qualificada === null) continue;
    const at = Date.parse(row.responded_at);
    if (Number.isNaN(at)) continue;
    const prev = latestAt.get(row.lead_id);
    // Empate exato de horário: mantém a primeira vista (determinístico).
    if (prev !== undefined && at <= prev) continue;
    latestAt.set(row.lead_id, at);
    result.set(row.lead_id, row.oportunidade_qualificada);
  }

  return result;
}
