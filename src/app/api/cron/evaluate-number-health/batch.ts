import { evaluateFlagRow, type FlagRow } from '@/features/contact-engine/services/flag-scope.service';

/** Quantas instancias elegiveis uma execucao tenta avaliar. */
export const HEALTH_EVALUATION_WORK_LIMIT = 100;

/** Pagina lida do banco. A varredura continua alem deste tamanho. */
export const HEALTH_EVALUATION_PAGE_SIZE = 100;

/**
 * `whatsapp_instances` e a tabela de instancias Evolution (migration
 * 20260223080000). Nao ha coluna `deleted_at` nem `provider` nesse schema:
 * cada linha e uma instancia Evolution ativa.
 *
 * A flag oficial nao usa usuario neste caminho. `allow_user_ids` so estreita
 * caminhos que carregam usuario; saude de numero segue o corte da org.
 */
export function orgEligibleForNumberHealth(flag: FlagRow, orgId: string): boolean {
  return evaluateFlagRow(flag, { orgId });
}

/**
 * Percorre as linhas ja ordenadas por `health_evaluated_at` (nulos primeiro)
 * e devolve ate `workLimit` instancias de orgs ligadas. Orgs desligadas nao
 * ocupam vaga: a varredura segue para as proximas, mesmo depois de 100 linhas.
 */
export function collectEligibleInstances<T extends { org_id: string }>(
  ordered: readonly T[],
  flag: FlagRow,
  workLimit: number = HEALTH_EVALUATION_WORK_LIMIT,
): T[] {
  const out: T[] = [];
  for (const row of ordered) {
    if (!orgEligibleForNumberHealth(flag, row.org_id)) continue;
    out.push(row);
    if (out.length >= workLimit) break;
  }
  return out;
}
