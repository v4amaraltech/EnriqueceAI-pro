import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { getCalendarConnectionWith, getCalendarEvent } from '@/features/integrations/services/calendar.service';

import { decideExternalChange } from '../services/slots';
import type { MeetingRequest } from './meeting-requests';

/**
 * BDR-4 — Alteração externa no calendário gera reconciliação, não reoferta:
 * closer moveu com o cliente → adota o novo horário; evento sumiu/cancelado →
 * conflito + alerta (humano decide se a IA reoferece).
 */
export async function reconcileMeetingRequests(): Promise<{ success: boolean; data?: { verificadas: number; adotadas: number; conflitos: number }; error?: string }> {
  const supabase = createServiceRoleClient();
  const out = { verificadas: 0, adotadas: 0, conflitos: 0 };
  const { data: reqs } = (await from(supabase, 'meeting_requests')
    .select('*').in('estado', ['evento_criado', 'confirmada']).not('google_event_id', 'is', null)
    .gte('slot_end', new Date().toISOString()).limit(200)) as { data: MeetingRequest[] | null };
  for (const req of reqs ?? []) {
    out.verificadas++;
    try {
      const conn = await getCalendarConnectionWith(supabase, req.closer_id, req.org_id);
      if (!conn) continue;
      const ev = await getCalendarEvent(conn, req.google_event_id!);
      const d = decideExternalChange({ request: { id: req.id, slot_start: req.slot_start!, slot_end: req.slot_end!, google_event_id: req.google_event_id }, event: ev });
      if (d.acao === 'ok') continue;
      if (d.acao === 'adotar') {
        await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id);
        await from(supabase, 'calendar_slots').insert({ org_id: req.org_id, closer_id: req.closer_id, slot_start: d.novoStart.toISOString(), slot_end: d.novoEnd.toISOString(), meeting_request_id: req.id } as Record<string, unknown>);
        await from(supabase, 'meeting_requests').update({ slot_start: d.novoStart.toISOString(), slot_end: d.novoEnd.toISOString(), erro: null } as Record<string, unknown>).eq('id', req.id);
        await from(supabase, 'leads').update({ meeting_starts_at: d.novoStart.toISOString() } as Record<string, unknown>).eq('id', req.lead_id);
        out.adotadas++;
        console.warn(`[agenda] solicitação ${req.id}: evento movido no calendário → horário adotado (${d.novoStart.toISOString()})`);
        continue;
      }
      await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id);
      await from(supabase, 'meeting_requests').update({ estado: 'conflito', erro: d.motivo } as Record<string, unknown>).eq('id', req.id);
      await from(supabase, 'scheduled_activities').insert({ org_id: req.org_id, lead_id: req.lead_id, user_id: req.closer_id, channel: 'calendar', scheduled_at: new Date().toISOString(), status: 'pending', notes: `[BDR IA] Reunião em conflito: ${d.motivo}. Decidir se a IA reoferece horários.` } as Record<string, unknown>).then(() => undefined, () => undefined);
      out.conflitos++;
      console.error(`[agenda] ALERTA solicitação ${req.id}: ${d.motivo} — sem reoferta automática`);
    } catch (e) {
      console.error(`[agenda] conciliação de ${req.id} falhou:`, e instanceof Error ? e.message : e);
    }
  }
  return { success: true, data: out };
}
