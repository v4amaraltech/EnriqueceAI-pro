import { handleIngestion } from '../../_ingestion-shared';
import { enrichmentRequestSchema } from '@/features/contact-engine/edge/edge-ingestion.schemas';
import { applyEnrichmentEdge } from '@/features/contact-engine/edge/edge-ingestion.service';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleIngestion(request, 'enrichment', enrichmentRequestSchema, (auth, body, ports) => applyEnrichmentEdge(ports, auth, body));
}
