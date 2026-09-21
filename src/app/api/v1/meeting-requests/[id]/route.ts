import { NextResponse } from 'next/server';

import { createServiceRoleClient } from '@/lib/supabase/service';
import { from } from '@/lib/supabase/from';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import { getMeetingRequest } from '@/features/bdr-agenda/actions/meeting-requests';
import { isUuid } from '@/shared/utils/uuid';

/** GET /api/v1/meeting-requests/{id} — solicitação + reserva atual. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ success: false, error: 'id inválido' }, { status: 400 });
  const supabase = createServiceRoleClient();
  const req = await getMeetingRequest(supabase, id, auth.orgId);
  if (!req) return NextResponse.json({ success: false, error: 'Solicitação não encontrada' }, { status: 404 });
  const { data: slot } = (await from(supabase, 'calendar_slots').select('slot_start, slot_end').eq('meeting_request_id', id).maybeSingle()) as { data: unknown | null };
  return NextResponse.json({ success: true, data: { request: req, slot } });
}
