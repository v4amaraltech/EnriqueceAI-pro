import { registerResult } from '@/features/contact-engine/edge/edge-command.service';
import { resultRequestSchema } from '@/features/contact-engine/edge/edge-command.schemas';

import { handleEdge } from '../../_shared';

export const dynamic = 'force-dynamic';

/** Contrato edge-command.v1. Ver docs/architecture/n8n-edge-adapters.md. */
export async function POST(request: Request) {
  return handleEdge(request, 'result', resultRequestSchema, registerResult);
}
