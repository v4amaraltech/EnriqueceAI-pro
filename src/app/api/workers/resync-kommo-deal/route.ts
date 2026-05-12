import { NextResponse } from 'next/server';

import { resyncCrmDealFields } from '@/features/leads/services/crm-resync.service';

export const maxDuration = 30;

/**
 * Worker to resync custom fields for an existing Kommo deal.
 * POST /api/workers/resync-kommo-deal
 * Body: { leadId: string }
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY
 *
 * The actual logic lives in features/leads/services/crm-resync.service so the
 * same flow is reused by the in-app "Resincronizar com Kommo" button (no curl
 * needed by the user).
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get('Authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { leadId } = (await request.json()) as { leadId: string };
  const result = await resyncCrmDealFields(leadId);

  if (result.errorCode) {
    // Unified error responses preserve the previous worker's behavior
    const httpStatus = result.errorCode === 'invalid_lead_id'
      ? 400
      : result.errorCode === 'no_subdomain'
        ? 500
        : 404;
    const msg = result.errorCode === 'invalid_lead_id'
      ? 'Invalid request'
      : result.errorCode === 'no_subdomain'
        ? 'No subdomain'
        : result.errorCode === 'no_synced_contact'
          ? 'No synced contact found'
          : result.errorCode === 'no_deal'
            ? 'No deal found in Kommo for this contact'
            : 'Not found';
    return NextResponse.json({ error: msg }, { status: httpStatus });
  }

  return NextResponse.json({
    success: result.success,
    dealId: result.dealId,
    fieldsTotal: result.fieldsTotal,
    succeeded: result.succeeded,
    failed: result.failed,
  });
}
