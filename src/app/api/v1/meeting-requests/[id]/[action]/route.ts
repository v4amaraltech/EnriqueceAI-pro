import { NextResponse } from 'next/server';

import { checkRateLimit } from '@/lib/security/rate-limit';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { authenticateApiKey } from '@/features/inbound-api/services/api-key-auth';
import {
  AgendaError, cancelRequest, confirmRequest, createEventForRequest, getMeetingRequest, rescheduleRequest, reserveSlot, suggestSlots,
} from '@/features/bdr-agenda/actions/meeting-requests';
import { isUuid } from '@/shared/utils/uuid';

const ACTIONS = new Set(['slots', 'reserve', 'create-event', 'reschedule', 'confirm', 'cancel']);

/**
 * BDR-4 — Ações do executor (n8n / Ana):
 *   slots        {count?, holidays?}       sugere horários livres
 *   reserve      {slot_start, slot_end?}   reserva atômica (409 slot_ocupado)
 *   create-event {}                        revalida, cria com id determinístico, confere 409, persiste; só depois confirme ao lead
 *   reschedule   {slot_start, slot_end?}   nova versão: reserva → patch → libera antigo
 *   confirm      {}                        lead confirmou (após evento_criado)
 *   cancel       {motivo?}
 * POST /api/v1/meeting-requests/{id}/{action}
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const auth = await authenticateApiKey(request);
  if (!auth) return NextResponse.json({ success: false, error: 'API key inválida ou expirada' }, { status: 401 });
  const rl = await checkRateLimit(`inbound-api:${auth.orgId}`, 100, 60_000);
  if (!rl.allowed) return NextResponse.json({ success: false, error: 'Rate limit excedido' }, { status: 429 });
  const { id, action } = await params;
  if (!isUuid(id) || !ACTIONS.has(action)) return NextResponse.json({ success: false, error: 'id ou ação inválidos' }, { status: 400 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = createServiceRoleClient();
  const req = await getMeetingRequest(supabase, id, auth.orgId);
  if (!req) return NextResponse.json({ success: false, error: 'Solicitação não encontrada' }, { status: 404 });
  const slotStart = typeof body.slot_start === 'string' ? body.slot_start : '';
  const slotEnd = typeof body.slot_end === 'string' ? body.slot_end : undefined;

  try {
    switch (action) {
      case 'slots':
        return NextResponse.json({ success: true, data: { slots: await suggestSlots(supabase, req, { count: Number(body.count ?? 2), holidays: Array.isArray(body.holidays) ? (body.holidays as string[]) : [] }) } });
      case 'reserve':
        if (!slotStart) return NextResponse.json({ success: false, error: 'slot_start obrigatório' }, { status: 400 });
        return NextResponse.json({ success: true, data: { request: await reserveSlot(supabase, req, slotStart, slotEnd) } });
      case 'create-event':
        return NextResponse.json({ success: true, data: { request: await createEventForRequest(supabase, req) } });
      case 'reschedule':
        if (!slotStart) return NextResponse.json({ success: false, error: 'slot_start obrigatório' }, { status: 400 });
        return NextResponse.json({ success: true, data: { request: await rescheduleRequest(supabase, req, slotStart, slotEnd) } });
      case 'confirm':
        return NextResponse.json({ success: true, data: { request: await confirmRequest(supabase, req) } });
      case 'cancel':
        await cancelRequest(supabase, req, typeof body.motivo === 'string' ? body.motivo : 'cancelada pelo executor');
        return NextResponse.json({ success: true, data: { estado: 'cancelada' } });
    }
  } catch (e) {
    if (e instanceof AgendaError) return NextResponse.json({ success: false, error: e.message, code: e.code }, { status: e.statusCode });
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
  return NextResponse.json({ success: false, error: 'ação desconhecida' }, { status: 400 });
}
