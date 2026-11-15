/**
 * Decisão pura de flag com escopo por organização (e, opcionalmente, por usuário).
 *
 *  - enabled = true  -> ligada para todos
 *  - enabled = false -> desligada, EXCETO para as organizações em allow_org_ids
 *  - allow_user_ids só estreita, e só quando há userId no escopo
 *  - sem org no escopo, só enabled conta
 *
 * Sem dependência de runtime: usado pelo app (flag-scope.service) e pelas
 * Edge Functions (Deno).
 */

export interface FlagScope {
  orgId?: string | null;
  userId?: string | null;
}

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

/** Decisão pura: a linha da flag vale como ligada para este escopo? */
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

/** A flag pode estar ligada para alguém (global ou alguma lista)? */
export function flagRowHasAnyScope(row: FlagRow | null | undefined): boolean {
  if (!row) return false;
  return row.enabled === true || normalizeIds(row.allow_org_ids).length > 0;
}
