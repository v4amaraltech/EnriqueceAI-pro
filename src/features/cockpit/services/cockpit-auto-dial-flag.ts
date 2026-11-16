import type { FlagScope } from '@/features/contact-engine/services/flag-scope.service';
import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { isCallCockpitOutcomesEnabled } from './cockpit-outcomes-flag';

/**
 * Flags do motor automático (CON-6). Todas nascem DESLIGADAS; linha ausente em `app_flags` ou erro de
 * leitura = desligada (NFR-4, falha fechada). Nunca liberar por `enabled = true` global (CON-3).
 *
 *  - `call_cockpit_outcomes` + `cockpit_auto_dial`: o motor aparece e roda SIMULADO.
 *  - + `cockpit_auto_dial_live`: liga de verdade (as 3 flags e o clique de Iniciar).
 */
export const COCKPIT_AUTO_DIAL_FLAG = 'cockpit_auto_dial';
export const COCKPIT_AUTO_DIAL_LIVE_FLAG = 'cockpit_auto_dial_live';

/** O motor (simulado) está liberado para o escopo: `call_cockpit_outcomes` E `cockpit_auto_dial`. */
export async function isCockpitAutoDialEnabled(scope?: FlagScope): Promise<boolean> {
  if (!(await isScopedFlagEnabled(COCKPIT_AUTO_DIAL_FLAG, scope))) return false;
  return isCallCockpitOutcomesEnabled(scope);
}

/** Ligação REAL liberada: as 3 flags ligadas para o escopo. */
export async function isCockpitAutoDialLive(scope?: FlagScope): Promise<boolean> {
  if (!(await isCockpitAutoDialEnabled(scope))) return false;
  return isScopedFlagEnabled(COCKPIT_AUTO_DIAL_LIVE_FLAG, scope);
}
