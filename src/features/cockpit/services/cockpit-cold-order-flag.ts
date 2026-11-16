import { isScopedFlagEnabled, type FlagScope } from '@/features/contact-engine/services/flag-scope.service';

/**
 * Ordem do lead frio no cartão "Próxima ligação" do Cockpit. Flag PRÓPRIA (não é
 * `call_priority_v2`): desligar esta não mexe na fila priorizada da Execução.
 * Nasce desligada e sem nenhuma org em `allow_org_ids`. Erro de leitura conta como desligada.
 */
export const COCKPIT_COLD_ORDER_FLAG = 'cockpit_cold_order';

export function isCockpitColdOrderEnabled(scope?: FlagScope): Promise<boolean> {
  return isScopedFlagEnabled(COCKPIT_COLD_ORDER_FLAG, scope);
}
