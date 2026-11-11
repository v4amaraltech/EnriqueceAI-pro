import { getAuthOrgIdResult } from '@/lib/auth/get-org-id';

import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

/** Cartão do lead no painel de ligação. Nasce desligada; só a org listada liga. */
export const CALL_LEAD_CARD_FLAG = 'call_lead_card_v1';

export const CALL_LEAD_CARD_ORG_ID = 'c2727473-1df8-4faa-9264-a9fc1759fe3b';

/** Erro de leitura conta como desligada. */
export function isCallLeadCardEnabled(orgId: string): Promise<boolean> {
  return isScopedFlagEnabled(CALL_LEAD_CARD_FLAG, { orgId });
}

export async function isCallLeadCardEnabledForViewer(): Promise<boolean> {
  const auth = await getAuthOrgIdResult();
  if (!auth.success) return false;
  return isCallLeadCardEnabled(auth.data.orgId);
}
