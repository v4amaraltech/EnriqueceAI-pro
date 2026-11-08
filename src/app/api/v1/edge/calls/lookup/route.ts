import { handleIngestion } from '../../_ingestion-shared';
import { callLookupRequestSchema } from '@/features/contact-engine/edge/edge-ingestion.schemas';
import { lookupCallEdge } from '@/features/contact-engine/edge/edge-ingestion.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleIngestion(request, 'calls', callLookupRequestSchema, (auth, body, ports) => lookupCallEdge(ports, auth, body));
}
