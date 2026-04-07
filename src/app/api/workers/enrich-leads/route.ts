import { NextResponse } from 'next/server';

import { CnpjWsProvider, LemitProvider } from '@/features/leads/services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '@/features/leads/services/enrichment.service';
import { LemitCpfProvider } from '@/features/leads/services/lemit-cpf-provider';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

// Allow long-running execution on Vercel (up to 5 minutes)
export const maxDuration = 300;

const BATCH_SIZE = 50;
const LEMIT_DELAY_MS = 2_000;
const CNPJWS_DELAY_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let importId: string;
  try {
    const body = await request.json();
    importId = body.importId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!importId || typeof importId !== 'string') {
    return NextResponse.json({ error: 'Missing importId' }, { status: 400 });
  }

  // Process synchronously — Vercel kills background tasks after response is sent
  try {
    await processLeadsBatch(importId);
    return NextResponse.json({ ok: true, importId }, { status: 200 });
  } catch (err) {
    console.error('[enrich-leads] Processing error:', err);
    return NextResponse.json(
      { ok: false, importId, error: 'Erro ao processar lote de enriquecimento' },
      { status: 500 },
    );
  }
}

async function processLeadsBatch(importId: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const startTime = Date.now();
  // Leave 30s buffer before Vercel kills the function (maxDuration = 300s)
  const maxRunMs = (maxDuration - 30) * 1000;

  // Determine provider (instantiate once)
  const lemitUrl = process.env.LEMIT_API_URL;
  const lemitToken = process.env.LEMIT_API_TOKEN;
  const useLemit = Boolean(lemitUrl && lemitToken);

  const cnpjProvider = useLemit
    ? new LemitProvider(lemitUrl!, lemitToken!)
    : new CnpjWsProvider();
  const cpfProvider = useLemit
    ? new LemitCpfProvider(lemitUrl!, lemitToken!)
    : null;

  const delayMs = useLemit ? LEMIT_DELAY_MS : CNPJWS_DELAY_MS;

  let totalProcessed = 0;

  // Process in batches until all done or time runs out
  while (true) {
    // Check time budget before fetching next batch
    if (Date.now() - startTime > maxRunMs) {
      console.warn(`[enrich-leads] Time budget exceeded after ${totalProcessed} leads, will resume on next trigger`);
      break;
    }

    const { data: leads, error } = (await from(supabase, 'leads')
      .select('id, cnpj')
      .eq('import_id', importId)
      .eq('enrichment_status', 'pending')
      .is('deleted_at', null)
      .not('cnpj', 'is', null)
      .limit(BATCH_SIZE)) as {
      data: Array<{ id: string; cnpj: string }> | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error('[enrich-leads] Query error:', error.message);
      break;
    }

    if (!leads || leads.length === 0) {
      console.warn(`[enrich-leads] All leads enriched for import ${importId} (total: ${totalProcessed})`);
      break;
    }

    console.warn(`[enrich-leads] Processing batch of ${leads.length} leads (total so far: ${totalProcessed})`);

    for (let i = 0; i < leads.length; i++) {
      // Check time budget before each lead
      if (Date.now() - startTime > maxRunMs) {
        console.warn(`[enrich-leads] Time budget exceeded mid-batch at lead ${i}/${leads.length}`);
        return;
      }

      const lead = leads[i]!;

      // Rate limiting delay (skip before first in batch)
      if (i > 0 || totalProcessed > 0) {
        await sleep(delayMs);
      }

      try {
        let result;
        if (cpfProvider) {
          result = await enrichLeadFull({
            leadId: lead.id,
            cnpj: lead.cnpj,
            cnpjProvider,
            cpfProvider,
            supabase,
          });
        } else {
          result = await enrichLead({
            leadId: lead.id,
            cnpj: lead.cnpj,
            provider: cnpjProvider,
            supabase,
          });
        }
        totalProcessed++;
        if (!result.success) {
          console.warn(`[enrich-leads] [${totalProcessed}] FAIL ${lead.cnpj}: ${result.error}`);
        }
      } catch (err) {
        totalProcessed++;
        console.error(`[enrich-leads] [${totalProcessed}] Exception for ${lead.cnpj}:`, err);
      }
    }
  }

  console.warn(`[enrich-leads] Complete for import ${importId}: ${totalProcessed} leads processed`);
}
