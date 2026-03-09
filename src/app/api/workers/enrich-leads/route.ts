import { NextResponse } from 'next/server';

import { CnpjWsProvider, LemitProvider } from '@/features/leads/services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '@/features/leads/services/enrichment.service';
import { LemitCpfProvider } from '@/features/leads/services/lemit-cpf-provider';
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
  // Auth: accept service_role_key
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey || authHeader !== `Bearer ${serviceRoleKey}`) {
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
      { ok: false, importId, error: String(err) },
      { status: 500 },
    );
  }
}

async function processLeadsBatch(importId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  // Fetch pending leads for this import
  const { data: leads, error } = (await from(supabase, 'leads')
    .select('id, cnpj')
    .eq('import_id', importId)
    .eq('enrichment_status', 'pending')
    .is('deleted_at', null)
    .limit(BATCH_SIZE)) as {
    data: Array<{ id: string; cnpj: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[enrich-leads] Query error:', error.message);
    return;
  }

  if (!leads || leads.length === 0) {
    console.warn('[enrich-leads] No pending leads for import', importId);
    return;
  }

  console.warn(`[enrich-leads] Processing ${leads.length} leads for import ${importId}`);

  // Determine provider (instantiate once outside loop)
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

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i]!;

    // Rate limiting delay (skip before first)
    if (i > 0) {
      await sleep(delayMs);
    }

    try {
      console.warn(`[enrich-leads] [${i + 1}/${leads.length}] Enriching lead ${lead.id} (CNPJ: ${lead.cnpj}) via ${cpfProvider ? 'Lemit' : 'CNPJ.ws'}...`);
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
      console.warn(`[enrich-leads] [${i + 1}/${leads.length}] Result: ${result.success ? 'SUCCESS' : `FAIL: ${result.error}`}`);
    } catch (err) {
      console.error(`[enrich-leads] [${i + 1}/${leads.length}] Exception for lead ${lead.id}:`, err);
    }
  }

  console.warn(`[enrich-leads] Batch complete for import ${importId} (${leads.length} leads)`);

  // Auto-chain: if we processed a full batch, there may be more pending
  if (leads.length === BATCH_SIZE) {
    console.warn('[enrich-leads] Full batch processed, auto-chaining next batch...');
    await selfChain(importId);
  }
}

async function selfChain(importId: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    console.error('[enrich-leads] Cannot auto-chain: missing SUPABASE_SERVICE_ROLE_KEY');
    return;
  }

  try {
    // Fire-and-forget: trigger next batch without waiting for it to finish
    fetch(`${appUrl}/api/workers/enrich-leads`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ importId }),
    }).catch((err) => {
      console.error('[enrich-leads] Auto-chain failed:', err);
    });
  } catch (err) {
    console.error('[enrich-leads] Auto-chain failed:', err);
  }
}
