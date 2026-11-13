import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Único caminho de UPDATE de `calls.metadata`. Chama a RPC `merge_calls_metadata`,
 * que faz `metadata = COALESCE(metadata, '{}') || patch` no banco.
 *
 * Por quê: ler o metadata, mesclar no JS e regravar o objeto inteiro apagava chaves
 * gravadas no meio por outro escritor. Em 13/11/2026 o `audio_stats` do webphone
 * apagou o marcador `crm_auto_update` do CRM automático em 2 ligações.
 *
 * Regra: `patch` leva SÓ as chaves que o escritor é dono (ex.: `{ audio_stats }`),
 * nunca o metadata inteiro relido. Com o objeto relido como patch, uma chave que
 * outro escritor atualizou no meio voltaria para o valor velho.
 *
 * INSERT de linha nova pode continuar mandando o metadata inicial direto.
 */

export interface MergeCallsMetadataOptions {
  /** Filtra pela org (recomendado sempre que o chamador conhece a org). */
  orgId?: string;
  /** Grava `sdr_disposition` no MESMO UPDATE do metadata (CRM automático). */
  sdrDisposition?: string;
  /** Guarda do CRM automático: só escreve se `sdr_disposition IS NULL`. */
  onlyIfDispositionNull?: boolean;
  /** Guarda do claim da IA: só escreve se `metadata.ai_outcome.status` for este valor. */
  onlyIfAiOutcomeStatus?: string;
}

/**
 * `updated = false`: nenhuma linha passou pelos filtros (ligação inexistente, outra
 * org, RLS ou guarda condicional). Erro do banco vem em `error`, sem lançar.
 */
export type MergeCallsMetadataResult = { updated: boolean; error: string | null };

type RpcFn = (
  fn: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;

export async function mergeCallsMetadata(
  db: SupabaseClient,
  callId: string,
  patch: Record<string, unknown>,
  options: MergeCallsMetadataOptions = {},
): Promise<MergeCallsMetadataResult> {
  const args: Record<string, unknown> = { p_id: callId, p_patch: patch };
  if (options.orgId) args.p_org_id = options.orgId;
  if (options.sdrDisposition) args.p_sdr_disposition = options.sdrDisposition;
  if (options.onlyIfDispositionNull) args.p_only_if_disposition_null = true;
  if (options.onlyIfAiOutcomeStatus)
    args.p_only_if_ai_outcome_status = options.onlyIfAiOutcomeStatus;

  const rpc = db.rpc.bind(db) as unknown as RpcFn;
  const { data, error } = await rpc('merge_calls_metadata', args);
  if (error) return { updated: false, error: error.message ?? 'unknown' };
  return { updated: data === true, error: null };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Espelho em JS do `COALESCE(metadata, '{}') || patch` da RPC (merge raso de chave
 * no topo). Usado nos testes para modelar o banco e documentar a semântica.
 */
export function applyMetadataPatch(
  current: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...(isPlainObject(current) ? current : {}), ...patch };
}

/**
 * Recorte mínimo: só as chaves de topo que `next` adiciona ou muda em relação a
 * `before`. Para escritores que montam o metadata com um helper que devolve o
 * objeto inteiro (ex.: `linkProviderIdToMetadata`). Remoção de chave não é
 * suportada pelo `||` e nenhum escritor precisa disso.
 */
export function metadataPatchFrom(
  before: unknown,
  next: Record<string, unknown>,
): Record<string, unknown> {
  const base = isPlainObject(before) ? before : {};
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (!(key in base) || JSON.stringify(base[key]) !== JSON.stringify(value)) patch[key] = value;
  }
  return patch;
}
