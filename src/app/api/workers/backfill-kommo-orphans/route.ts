import { NextResponse } from 'next/server';

import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { pushLeadToCrmWithDefaults } from '@/features/leads/services/crm-push.service';

export const maxDuration = 300;

/**
 * One-shot worker that finds every won lead in an org without a
 * crm_deal_created interaction and pushes it to the connected CRM. Each
 * underlying call is idempotent (pushLeadToCrm checks for the dedup
 * interaction before creating), so re-running is safe.
 *
 * POST /api/workers/backfill-kommo-orphans
 * Body: { orgId: string, dryRun?: boolean, limit?: number }
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    orgId?: string;
    dryRun?: boolean;
    limit?: number;
  };
  const orgId = body.orgId;
  const dryRun = body.dryRun === true;
  const limit = Math.min(body.limit ?? 100, 500);

  if (!orgId) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Won leads without a crm_deal_created interaction. Service role + explicit
  // org filter (RLS would block this anyway in service mode).
  const { data: orphans } = (await from(supabase, 'leads')
    .select('id, razao_social, cnpj, won_at')
    .eq('org_id', orgId)
    .eq('status', 'won')
    .is('deleted_at', null)
    .order('won_at', { ascending: false })
    .limit(limit)) as {
    data: Array<{ id: string; razao_social: string | null; cnpj: string | null; won_at: string | null }> | null;
  };

  if (!orphans || orphans.length === 0) {
    return NextResponse.json({ found: 0, pushed: 0, message: 'No won leads' });
  }

  const filtered: Array<{ id: string; razao_social: string | null; cnpj: string | null; won_at: string | null }> = [];
  for (const lead of orphans) {
    const { data: alreadyPushed } = (await from(supabase, 'interactions')
      .select('id')
      .eq('lead_id', lead.id)
      .eq('type', 'crm_deal_created')
      .limit(1)
      .maybeSingle()) as { data: { id: string } | null };
    if (!alreadyPushed) filtered.push(lead);
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      found: filtered.length,
      leads: filtered.map((l) => ({
        id: l.id,
        razao_social: l.razao_social,
        cnpj: l.cnpj,
        won_at: l.won_at,
      })),
    });
  }

  const results: Array<{ id: string; razao_social: string | null; result: unknown }> = [];
  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (const lead of filtered) {
    try {
      const r = await pushLeadToCrmWithDefaults(orgId, lead.id);
      if (r.dealCreated) {
        pushed++;
      } else if (r.skippedReason) {
        skipped++;
      } else {
        failed++;
      }
      results.push({ id: lead.id, razao_social: lead.razao_social, result: r });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'unknown';
      results.push({ id: lead.id, razao_social: lead.razao_social, result: { error: msg } });
    }
  }

  return NextResponse.json({
    found: filtered.length,
    pushed,
    skipped,
    failed,
    results,
  });
}
