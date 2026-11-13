/**
 * Modelo em memória da RPC `merge_calls_metadata` (migration 20261113120000).
 * Aplica `metadata = COALESCE(metadata, '{}') || p_patch` e as guardas opcionais
 * nas linhas de `calls`, como o UPDATE do banco. Só para testes.
 */
import { applyMetadataPatch } from '@/features/calls/services/merge-calls-metadata';

type Row = Record<string, unknown>;

export interface MergeCallsMetadataArgs {
  p_id: string;
  p_patch: Record<string, unknown>;
  p_org_id?: string;
  p_sdr_disposition?: string;
  p_only_if_disposition_null?: boolean;
  p_only_if_ai_outcome_status?: string;
}

function aiOutcomeStatus(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const ai = (metadata as Row).ai_outcome;
  return ai && typeof ai === 'object' ? (ai as Row).status : undefined;
}

/** Linhas que passam pelos filtros da RPC. */
export function mergeCallsMetadataTargets(rows: Row[], args: MergeCallsMetadataArgs): Row[] {
  return rows.filter(
    (r) =>
      r.id === args.p_id &&
      (args.p_org_id === undefined || r.org_id === args.p_org_id) &&
      (!args.p_only_if_disposition_null || (r.sdr_disposition ?? null) === null) &&
      (args.p_only_if_ai_outcome_status === undefined ||
        aiOutcomeStatus(r.metadata) === args.p_only_if_ai_outcome_status),
  );
}

/** Aplica a RPC em `rows` (muta as linhas) e devolve o retorno do PostgREST. */
export function applyMergeCallsMetadataRpc(
  rows: Row[],
  args: MergeCallsMetadataArgs,
): { data: boolean; error: null; affected: number } {
  const hit = mergeCallsMetadataTargets(rows, args);
  for (const r of hit) {
    r.metadata = applyMetadataPatch(r.metadata, args.p_patch);
    if (args.p_sdr_disposition !== undefined) r.sdr_disposition = args.p_sdr_disposition;
    r.updated_at = new Date().toISOString();
  }
  return { data: hit.length > 0, error: null, affected: hit.length };
}
