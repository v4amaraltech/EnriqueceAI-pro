import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { LEAD_CHANNEL_CHAT_FLAG } from './constants';

/** Erro de leitura conta como desligada. A checagem usa service role. */
export function isLeadChannelChatEnabled(orgId: string): Promise<boolean> {
  return isScopedFlagEnabled(LEAD_CHANNEL_CHAT_FLAG, { orgId });
}
