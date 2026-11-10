import { isScopedFlagEnabled } from '@/features/contact-engine/services/flag-scope.service';

import { CLOSER_CALENDAR_CONNECT_FLAG } from './constants';

/** Erro de leitura conta como desligada. SDR nao lê app_flags; a checagem usa service role. */
export function isCloserCalendarConnectEnabled(orgId: string): Promise<boolean> {
  return isScopedFlagEnabled(CLOSER_CALENDAR_CONNECT_FLAG, { orgId });
}
