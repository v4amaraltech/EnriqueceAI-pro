import { isFlagEnabledForAnyScope, isScopedFlagEnabled, type FlagScope } from '@/features/contact-engine/services/flag-scope.service';

export const CALL_COCKPIT_OUTCOMES_FLAG_KEY = 'call_cockpit_outcomes';

/**
 * Flag `call_cockpit_outcomes` em `app_flags`. Sem escopo: leitura global de sempre.
 * Com escopo (PR12): global ou organizacao/usuario liberados. Em erro de leitura vale desligada.
 */
export async function isCallCockpitOutcomesEnabled(scope?: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(CALL_COCKPIT_OUTCOMES_FLAG_KEY, scope);
}

/** Portao barato antes de autenticar: ligada globalmente ou em alguma lista. */
export function isCallCockpitOutcomesEnabledForAnyScope(): Promise<boolean> {
  return isFlagEnabledForAnyScope(CALL_COCKPIT_OUTCOMES_FLAG_KEY);
}
