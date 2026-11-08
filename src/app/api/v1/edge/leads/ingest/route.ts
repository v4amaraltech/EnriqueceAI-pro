import { handleIngestion } from '../../_ingestion-shared';
import { leadIngestRequestSchema } from '@/features/contact-engine/edge/edge-ingestion.schemas';
import { ingestLeadsEdge } from '@/features/contact-engine/edge/edge-ingestion.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleIngestion(request, 'leads', leadIngestRequestSchema, (auth, body, ports) => ingestLeadsEdge(ports, auth, body));
}
