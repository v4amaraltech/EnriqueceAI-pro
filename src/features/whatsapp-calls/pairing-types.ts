import type { ActionResult } from '@/lib/actions/action-result';

import type { WhatsAppCallSessionStatus } from './types';

export interface PairingResult {
  sid: string;
  status: WhatsAppCallSessionStatus;
  qr: string | null;
  phoneNumber: string | null;
}

/**
 * Conjunto de actions que conduzem um pareamento. Injetável no PairNumberDialog
 * para reaproveitar o mesmo fluxo de QR/SSE em dois contextos:
 *  - manager (default): pareia o número de qualquer SDR (`actions/pairing.ts`)
 *  - self-service: o SDR pareia o PRÓPRIO número (`actions/pairing-self.ts`)
 */
export interface PairingActions {
  create: (userId: string) => Promise<ActionResult<PairingResult>>;
  getStatus: (sid: string) => Promise<ActionResult<PairingResult>>;
  cancel: (sid: string) => Promise<ActionResult<{ canceled: true }>>;
}
