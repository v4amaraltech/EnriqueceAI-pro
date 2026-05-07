import { NextResponse } from 'next/server';

import { CnpjWsProvider, LemitProvider } from '@/features/leads/services/enrichment-provider';
import { enrichLead, enrichLeadFull } from '@/features/leads/services/enrichment.service';
import { LemitCpfProvider } from '@/features/leads/services/lemit-cpf-provider';
import { verifyCronSecret } from '@/lib/auth/verify-cron-secret';
import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';

export const maxDuration = 300;

const BATCH_SIZE = 30;
const LEMIT_DELAY_MS = 2_000;
const CNPJWS_DELAY_MS = 20_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Enriches leads that ended up pending without a parent import_id — leads created
 * manually via the dashboard, by CRM webhooks, by inbound API, or by integrations
 * (HubSpot/Pipedrive/RD/Apollo). The original enrich-leads worker only processes
 * leads tied to an import, so any other path was leaving leads stuck in pending.
 *
 * Same provider + rate-limit logic as that worker, but scoped to leads with cnpj
 * IS NOT NULL (no CNPJ → cannot enrich; that subset is cleaned up to not_found
 * by a separate query).
 */
export async function POST(request: Request) {
  if (!verifyServiceRole(request) && !verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await processPendingLeads();
    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (err) {
    console.error('[enrich-pending-leads] Processing error:', err);
    return NextResponse.json(
      { ok: false, error: 'Erro ao processar leads pendentes' },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return POST(request);
}

async function processPendingLeads(): Promise<{ processed: number; succeeded: number; failed: number }> {
  const supabase = createServiceRoleClient();
  const startTime = Date.now();
  const maxRunMs = (maxDuration - 30) * 1000;

  const lemitUrl = process.env.LEMIT_API_URL;
  const lemitToken = process.env.LEMIT_API_TOKEN;
  const useLemit = Boolean(lemitUrl && lemitToken);

  const cnpjProvider = useLemit ? new LemitProvider(lemitUrl!, lemitToken!) : new CnpjWsProvider();
  const cpfProvider = useLemit ? new LemitCpfProvider(lemitUrl!, lemitToken!) : null;
  const delayMs = useLemit ? LEMIT_DELAY_MS : CNPJWS_DELAY_MS;

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  const { data: leads, error } = (await from(supabase, 'leads')
    .select('id, cnpj')
    .eq('enrichment_status', 'pending')
    .is('deleted_at', null)
    .not('cnpj', 'is', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)) as {
    data: Array<{ id: string; cnpj: string }> | null;
    error: { message: string } | null;
  };

  if (error) {
    console.error('[enrich-pending-leads] Query error:', error.message);
    throw new Error(error.message);
  }

  if (!leads || leads.length === 0) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  console.warn(`[enrich-pending-leads] Picked up ${leads.length} pending leads`);

  for (let i = 0; i < leads.length; i++) {
    if (Date.now() - startTime > maxRunMs) {
      console.warn(`[enrich-pending-leads] Time budget exceeded at ${i}/${leads.length}`);
      break;
    }

    const lead = leads[i]!;

    if (i > 0) await sleep(delayMs);

    try {
      const result = cpfProvider
        ? await enrichLeadFull({ leadId: lead.id, cnpj: lead.cnpj, cnpjProvider, cpfProvider, supabase })
        : await enrichLead({ leadId: lead.id, cnpj: lead.cnpj, provider: cnpjProvider, supabase });

      processed++;
      if (result.success) {
        succeeded++;
      } else {
        failed++;
        console.warn(`[enrich-pending-leads] FAIL ${lead.cnpj}: ${result.error}`);
      }
    } catch (err) {
      processed++;
      failed++;
      console.error(`[enrich-pending-leads] Exception for ${lead.cnpj}:`, err);
    }
  }

  return { processed, succeeded, failed };
}
