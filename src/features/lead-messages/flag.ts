import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { LEAD_MESSAGES_CAPTURE_FLAG } from './constants';

/** Erro de leitura conta como desligada. A checagem usa service role. */
export function isLeadMessagesCaptureEnabled(orgId: string): Promise<boolean> {
  return isScopedFlagEnabled(LEAD_MESSAGES_CAPTURE_FLAG, { orgId });
}
