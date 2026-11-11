import { evaluateFlagRow, isScopedFlagEnabled, type FlagRow, type FlagScope } from '@/features/contact-engine/services/flag-scope.service';

export const WEBPHONE_LIVE_AMD_FLAG_KEY = 'webphone_live_amd';

/** V4 Company Amaral. Única org do piloto enquanto enabled permanecer false. */
export const WEBPHONE_LIVE_AMD_PILOT_ORG_ID = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

/** Decisão pura. enabled = false e a org na lista liga só essa org. */
export function webphoneLiveAmdEnabledFor(row: FlagRow | null | undefined, scope?: FlagScope): boolean {
  return evaluateFlagRow(row, scope);
}

/** Leitura da flag para o usuário logado. Erro de leitura conta como desligada. */
export function isWebphoneLiveAmdEnabled(scope: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(WEBPHONE_LIVE_AMD_FLAG_KEY, scope);
}
