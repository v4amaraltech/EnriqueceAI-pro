import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

/**
 * Leitura unica de flags do motor com escopo opcional (PR12).
 *
 * Modelo (aditivo sobre `app_flags`, sem tabela nova):
 *  - `enabled = true`  -> ligada para todos (comportamento global de sempre).
 *  - `enabled = false` -> desligada, EXCETO para as organizacoes em `allow_org_ids`.
 *  - `allow_user_ids` so estreita: com a lista preenchida, os caminhos que carregam
 *    um usuario (SDR/closer) so ligam para os usuarios listados. Caminhos sem usuario
 *    (dispatcher, outbox, saude de numero) seguem o corte da organizacao.
 *  - Usuario listado numa organizacao fora de `allow_org_ids` nunca liga (o corte por
 *    organizacao e sempre o primeiro portao).
 *  - Sem escopo informado, a leitura e global: so `enabled` conta, exatamente como antes.
 *  - Flag desligada + listas vazias (ou colunas ainda inexistentes) = comportamento atual.
 *
 * Desligar a flag global NAO desliga uma organizacao que esteja na lista: a pausa
 * completa limpa as listas (ver docs/runbooks/motor-contato-piloto.md).
 */

export interface FlagScope {
  orgId?: string | null;
  userId?: string | null;
}

export type FlagState = 'on' | 'off' | 'error';

export interface FlagRow {
  enabled: boolean;
  allow_org_ids?: string[] | null;
  allow_user_ids?: string[] | null;
}

function normalizeIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v.toLowerCase());
}

/** Decisao pura: a linha da flag vale como ligada para este escopo? */
export function evaluateFlagRow(row: FlagRow | null | undefined, scope?: FlagScope): boolean {
  if (!row) return false;
  if (row.enabled === true) return true;
  const orgId = scope?.orgId ? scope.orgId.toLowerCase() : null;
  if (!orgId) return false;
  if (!normalizeIds(row.allow_org_ids).includes(orgId)) return false;
  const users = normalizeIds(row.allow_user_ids);
  if (users.length === 0) return true;
  const userId = scope?.userId ? scope.userId.toLowerCase() : null;
  if (!userId) return true;
  return users.includes(userId);
}

/** A flag pode estar ligada para alguem (global ou alguma lista)? Usado como portao barato de ciclos. */
export function flagRowHasAnyScope(row: FlagRow | null | undefined): boolean {
  if (!row) return false;
  return row.enabled === true || normalizeIds(row.allow_org_ids).length > 0;
}

type RowsResult = { data: FlagRow[] | null; error?: { message: string } | null };

async function readFlagRow(key: string, scoped: boolean): Promise<FlagRow | null | 'error'> {
  try {
    const db = createServiceRoleClient();
    if (scoped) {
      const full = (await from(db, 'app_flags')
        .select('enabled, allow_org_ids, allow_user_ids')
        .eq('key', key)
        .limit(1)) as RowsResult;
      if (!full.error) return full.data?.[0] ?? null;
      // Colunas de escopo ainda nao aplicadas: cai para a leitura global de sempre.
    }
    const plain = (await from(db, 'app_flags')
      .select('enabled')
      .eq('key', key)
      .limit(1)) as RowsResult;
    if (plain.error) return 'error';
    return plain.data?.[0] ?? null;
  } catch {
    return 'error';
  }
}

/** Estado tri-valorado: `error` permite que flags de restricao falhem fechadas. */
export async function readScopedFlagState(key: string, scope?: FlagScope): Promise<FlagState> {
  const hasScope = Boolean(scope?.orgId);
  const row = await readFlagRow(key, hasScope);
  if (row === 'error') return 'error';
  return evaluateFlagRow(row, scope) ? 'on' : 'off';
}

/** Flag de efeito: erro de leitura conta como desligada. */
export async function isScopedFlagEnabled(key: string, scope?: FlagScope): Promise<boolean> {
  return (await readScopedFlagState(key, scope)) === 'on';
}

/** Portao de ciclo: ligada globalmente ou em alguma lista. Erro conta como desligada. */
export async function isFlagEnabledForAnyScope(key: string): Promise<boolean> {
  const row = await readFlagRow(key, true);
  if (row === 'error') return false;
  return flagRowHasAnyScope(row);
}
