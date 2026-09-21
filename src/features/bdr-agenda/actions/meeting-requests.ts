import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';
import {
  CalendarConflictError, CalendarEventGoneError, checkFreeBusy, createCalendarEvent, getCalendarConnectionWith,
  getCalendarEvent, updateCalendarEvent, type CalendarConnectionTokens,
} from '@/features/integrations/services/calendar.service';

import { computeFreeSlots, conflictMatchesRequest, deriveEventId, slotLabelPt } from '../services/slots';

export const ESTADOS_ATIVOS = ['aberta', 'slot_reservado', 'evento_criado', 'confirmada', 'conflito'];
const DURACAO_MIN = 45;

export interface MeetingRequest {
  id: string; org_id: string; lead_id: string; closer_id: string; conversation_id: string | null; origem: string;
  execution_id: string | null; versao: number; estado: string; slot_start: string | null; slot_end: string | null;
  google_event_id: string | null; meet_link: string | null; html_link: string | null; interaction_id: string | null; erro: string | null;
}

export class AgendaError extends Error {
  constructor(message: string, public readonly statusCode: number, public readonly code: string) { super(message); }
}

async function closerConnection(supabase: SupabaseClient, closerId: string, orgId: string): Promise<CalendarConnectionTokens> {
  const c = await getCalendarConnectionWith(supabase, closerId, orgId);
  if (!c) throw new AgendaError('Closer sem agenda Google conectada', 409, 'agenda_indisponivel');
  return c;
}

export async function getMeetingRequest(supabase: SupabaseClient, id: string, orgId: string): Promise<MeetingRequest | null> {
  const { data } = (await from(supabase, 'meeting_requests').select('*').eq('id', id).eq('org_id', orgId).maybeSingle()) as { data: MeetingRequest | null };
  return data;
}

/** Uma solicitação ativa por lead, compartilhada pelos canais; idempotente por execution_id. */
export async function getOrCreateMeetingRequest(supabase: SupabaseClient, p: {
  orgId: string; leadId: string; closerId: string; conversationId?: string | null; origem: string; executionId?: string | null;
}): Promise<{ request: MeetingRequest; criada: boolean }> {
  if (p.executionId) {
    const { data: byExec } = (await from(supabase, 'meeting_requests').select('*').eq('execution_id', p.executionId).maybeSingle()) as { data: MeetingRequest | null };
    if (byExec) return { request: byExec, criada: false };
  }
  const { data: ativa } = (await from(supabase, 'meeting_requests').select('*').eq('lead_id', p.leadId).in('estado', ESTADOS_ATIVOS).maybeSingle()) as { data: MeetingRequest | null };
  if (ativa) return { request: ativa, criada: false };
  const { data: created, error } = (await from(supabase, 'meeting_requests')
    .insert({ org_id: p.orgId, lead_id: p.leadId, closer_id: p.closerId, conversation_id: p.conversationId ?? null, origem: p.origem, execution_id: p.executionId ?? null } as Record<string, unknown>)
    .select('*').maybeSingle()) as { data: MeetingRequest | null; error: { code?: string; message: string } | null };
  if (!created) {
    // Corrida: outra execução criou a ativa do lead entre o select e o insert
    const { data: again } = (await from(supabase, 'meeting_requests').select('*').eq('lead_id', p.leadId).in('estado', ESTADOS_ATIVOS).maybeSingle()) as { data: MeetingRequest | null };
    if (again) return { request: again, criada: false };
    throw new AgendaError(`Não foi possível criar a solicitação: ${error?.message ?? '?'}`, 500, 'erro');
  }
  return { request: created, criada: true };
}

/** Dois horários livres do closer: freeBusy + reservas locais + feriados. */
export async function suggestSlots(supabase: SupabaseClient, req: MeetingRequest, { count = 2, holidays = [] as string[] } = {}) {
  const conn = await closerConnection(supabase, req.closer_id, req.org_id);
  const now = new Date();
  const timeMax = new Date(now.getTime() + 11 * 86400000);
  const [busy, reservedRows] = await Promise.all([
    checkFreeBusy(conn, now.toISOString(), timeMax.toISOString()),
    from(supabase, 'calendar_slots').select('slot_start, slot_end').eq('closer_id', req.closer_id).gte('slot_end', now.toISOString()) as unknown as Promise<{ data: Array<{ slot_start: string; slot_end: string }> | null }>,
  ]);
  const reserved = (reservedRows.data ?? []).map((r) => ({ start: r.slot_start, end: r.slot_end }));
  return computeFreeSlots({ now, busy, reserved, count, durationMin: DURACAO_MIN, holidays })
    .map((s) => ({ start: s.start.toISOString(), end: s.end.toISOString(), label: slotLabelPt(s.start) }));
}

/** Reserva atômica: a constraint de exclusão decide; dois leads no mesmo horário → um recebe 409. */
export async function reserveSlot(supabase: SupabaseClient, req: MeetingRequest, slotStart: string, slotEnd?: string): Promise<MeetingRequest> {
  if (!['aberta', 'conflito', 'slot_reservado'].includes(req.estado)) throw new AgendaError(`Solicitação em estado '${req.estado}'`, 409, 'estado_invalido');
  const start = new Date(slotStart);
  const end = slotEnd ? new Date(slotEnd) : new Date(start.getTime() + DURACAO_MIN * 60000);
  if (Number.isNaN(start.getTime()) || end <= start) throw new AgendaError('Horário inválido', 400, 'horario_invalido');
  if (start.getTime() < Date.now()) throw new AgendaError('Horário no passado', 400, 'horario_invalido');

  // Libera reserva anterior desta solicitação (troca de horário antes do evento)
  await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id);
  const { error } = await from(supabase, 'calendar_slots')
    .insert({ org_id: req.org_id, closer_id: req.closer_id, slot_start: start.toISOString(), slot_end: end.toISOString(), meeting_request_id: req.id } as Record<string, unknown>);
  if (error) {
    if ((error as { code?: string }).code === '23P01' || (error as { code?: string }).code === '23505') {
      throw new AgendaError('Horário acabou de ser reservado para outro lead', 409, 'slot_ocupado');
    }
    throw new AgendaError(`Reserva falhou: ${error.message}`, 500, 'erro');
  }
  const { data } = (await from(supabase, 'meeting_requests')
    .update({ estado: 'slot_reservado', slot_start: start.toISOString(), slot_end: end.toISOString(), erro: null } as Record<string, unknown>)
    .eq('id', req.id).select('*').maybeSingle()) as { data: MeetingRequest | null };
  return data ?? { ...req, estado: 'slot_reservado', slot_start: start.toISOString(), slot_end: end.toISOString() };
}

async function leadInfo(supabase: SupabaseClient, leadId: string) {
  const { data } = (await from(supabase, 'leads').select('id, first_name, last_name, email, razao_social, nome_fantasia').eq('id', leadId).maybeSingle()) as {
    data: { id: string; first_name: string | null; last_name: string | null; email: string | null; razao_social: string | null; nome_fantasia: string | null } | null;
  };
  return data;
}

/**
 * Cria o evento: revalida freeBusy → insert com id determinístico e tag da
 * solicitação → 409 só é sucesso se o evento existente bater (solicitação,
 * horário, participante, não cancelado). Persiste no lead/interactions no
 * mesmo formato do agendamento manual (o cron da Luiza enxerga).
 */
export async function createEventForRequest(supabase: SupabaseClient, req: MeetingRequest): Promise<MeetingRequest> {
  if (req.estado === 'evento_criado' || req.estado === 'confirmada') return req; // idempotente
  if (req.estado !== 'slot_reservado' || !req.slot_start || !req.slot_end) throw new AgendaError('Reserve um horário antes de criar o evento', 409, 'sem_slot');
  const conn = await closerConnection(supabase, req.closer_id, req.org_id);
  const lead = await leadInfo(supabase, req.lead_id);
  const empresa = lead?.nome_fantasia || lead?.razao_social || 'Lead';
  const nome = [lead?.first_name, lead?.last_name].filter(Boolean).join(' ') || 'contato';

  // Revalidação: alguém pode ter marcado direto no calendário
  const busy = await checkFreeBusy(conn, req.slot_start, req.slot_end);
  if (busy.length) {
    await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id);
    await from(supabase, 'meeting_requests').update({ estado: 'conflito', erro: 'horário ocupado no calendário na revalidação' } as Record<string, unknown>).eq('id', req.id);
    throw new AgendaError('Horário ocupado no calendário do closer; ofereça outros', 409, 'conflito_calendario');
  }

  const eventId = deriveEventId(req.id, req.versao);
  const input = {
    title: `Reunião V4 Company — ${empresa}`,
    description: `Diagnóstico de 30-45 min com ${nome} (${empresa}). Origem: ${req.origem} (BDR IA). Solicitação ${req.id} v${req.versao}.`,
    startTime: req.slot_start, endTime: req.slot_end,
    attendeeEmails: lead?.email ? [lead.email] : [],
    generateMeetLink: true, closerId: req.closer_id,
    eventId, extendedProperties: { meeting_request_id: req.id, versao: String(req.versao) },
  };
  let created: { id: string; htmlLink: string; meetLink: string | null };
  try {
    created = await createCalendarEvent(conn, input);
  } catch (e) {
    if (e instanceof CalendarConflictError) {
      const existing = await getCalendarEvent(conn, eventId);
      if (!conflictMatchesRequest({ request: { id: req.id, slot_start: req.slot_start, slot_end: req.slot_end }, event: existing, attendeeEmail: lead?.email ?? null })) {
        await from(supabase, 'meeting_requests').update({ estado: 'conflito', erro: `409 no id ${eventId} com evento diferente` } as Record<string, unknown>).eq('id', req.id);
        console.error(`[agenda] ALERTA solicitação ${req.id}: 409 no id ${eventId} e o evento existente não corresponde — nunca confirmar ao lead`);
        throw new AgendaError('Já existe um evento diferente com este id; conciliação humana necessária', 409, 'conflito_evento');
      }
      created = { id: existing!.id, htmlLink: existing!.htmlLink, meetLink: existing!.meetLink };
    } else {
      await from(supabase, 'meeting_requests').update({ erro: e instanceof Error ? e.message : String(e) } as Record<string, unknown>).eq('id', req.id);
      throw e;
    }
  }

  // Releitura comprova o evento antes de qualquer confirmação ao lead
  const check = await getCalendarEvent(conn, created.id);
  if (!check || check.status === 'cancelled') {
    await from(supabase, 'meeting_requests').update({ estado: 'conflito', erro: 'evento não confirmado na releitura' } as Record<string, unknown>).eq('id', req.id);
    throw new AgendaError('Evento não confirmado na releitura', 409, 'conflito_evento');
  }

  const interactionId = await persistMeeting(supabase, req, { eventId: created.id, htmlLink: created.htmlLink, meetLink: created.meetLink, title: input.title, description: input.description, attendees: input.attendeeEmails });
  const { data } = (await from(supabase, 'meeting_requests')
    .update({ estado: 'evento_criado', google_event_id: created.id, meet_link: created.meetLink, html_link: created.htmlLink, interaction_id: interactionId, erro: null } as Record<string, unknown>)
    .eq('id', req.id).select('*').maybeSingle()) as { data: MeetingRequest | null };
  return data ?? req;
}

async function persistMeeting(supabase: SupabaseClient, req: MeetingRequest, ev: { eventId: string; htmlLink: string; meetLink: string | null; title: string; description: string; attendees: string[] }): Promise<string | null> {
  const meta = { subject: ev.title, calendar_event_id: ev.eventId, calendar_link: ev.htmlLink, meet_link: ev.meetLink, attendees: ev.attendees, closer_id: req.closer_id, start_time: req.slot_start, end_time: req.slot_end, meeting_request_id: req.id, source: 'bdr_ia' };
  const { data: inter } = (await from(supabase, 'interactions').insert({
    org_id: req.org_id, lead_id: req.lead_id, type: 'meeting_scheduled', channel: 'calendar',
    message_content: [ev.title, ev.description, ev.meetLink ? `Google Meet: ${ev.meetLink}` : ''].filter(Boolean).join('\n'),
    metadata: meta, performed_by: req.closer_id, ai_generated: true,
  } as Record<string, unknown>).select('id').maybeSingle()) as { data: { id: string } | null };
  const nowIso = new Date().toISOString();
  await from(supabase, 'leads').update({ meeting_scheduled_at: nowIso, meeting_starts_at: req.slot_start, qualified_at: nowIso, status: 'qualified', closer_id: req.closer_id } as Record<string, unknown>).eq('id', req.lead_id).eq('org_id', req.org_id);
  await from(supabase, 'cadence_enrollments').update({ status: 'completed', completed_at: nowIso } as Record<string, unknown>).eq('lead_id', req.lead_id).in('status', ['active', 'paused']);
  await from(supabase, 'contact_holds').upsert({ org_id: req.org_id, lead_id: req.lead_id, tipo: 'prospeccao', origem: 'reuniao_agendada' } as Record<string, unknown>, { onConflict: 'lead_id,tipo', ignoreDuplicates: true });
  return inter?.id ?? null;
}

/** Remarcação = nova versão da MESMA solicitação: reserva o novo slot, patch no evento, libera o antigo. */
export async function rescheduleRequest(supabase: SupabaseClient, req: MeetingRequest, slotStart: string, slotEnd?: string): Promise<MeetingRequest> {
  if (!['evento_criado', 'confirmada', 'conflito'].includes(req.estado) || !req.google_event_id) throw new AgendaError('Só remarca solicitação com evento criado', 409, 'estado_invalido');
  const conn = await closerConnection(supabase, req.closer_id, req.org_id);
  const antigo = { start: req.slot_start, end: req.slot_end };
  const versao = req.versao + 1;
  const start = new Date(slotStart);
  const end = slotEnd ? new Date(slotEnd) : new Date(start.getTime() + DURACAO_MIN * 60000);
  if (Number.isNaN(start.getTime()) || end <= start || start.getTime() < Date.now()) throw new AgendaError('Horário inválido', 400, 'horario_invalido');

  // Reserva o novo (sem soltar o antigo antes: o antigo só libera após o patch)
  const { error } = await from(supabase, 'calendar_slots')
    .insert({ org_id: req.org_id, closer_id: req.closer_id, slot_start: start.toISOString(), slot_end: end.toISOString(), meeting_request_id: req.id } as Record<string, unknown>);
  if (error) {
    if ((error as { code?: string }).code === '23P01' || (error as { code?: string }).code === '23505') throw new AgendaError('Novo horário já reservado', 409, 'slot_ocupado');
    throw new AgendaError(`Reserva falhou: ${error.message}`, 500, 'erro');
  }
  const lead = await leadInfo(supabase, req.lead_id);
  const empresa = lead?.nome_fantasia || lead?.razao_social || 'Lead';
  const input = {
    title: `Reunião V4 Company — ${empresa}`,
    description: `Reunião remarcada (v${versao}). Solicitação ${req.id}.`,
    startTime: start.toISOString(), endTime: end.toISOString(),
    attendeeEmails: lead?.email ? [lead.email] : [], closerId: req.closer_id,
  };
  let eventId = req.google_event_id;
  let meetLink = req.meet_link, htmlLink = req.html_link;
  try {
    const up = await updateCalendarEvent(conn, req.google_event_id, input);
    meetLink = up.meetLink ?? meetLink; htmlLink = up.htmlLink;
  } catch (e) {
    if (!(e instanceof CalendarEventGoneError)) {
      await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id).eq('slot_start', start.toISOString());
      throw e;
    }
    // Evento cancelado/inexistente: insert com id da nova versão
    eventId = deriveEventId(req.id, versao);
    const cr = await createCalendarEvent(conn, { ...input, generateMeetLink: true, eventId, extendedProperties: { meeting_request_id: req.id, versao: String(versao) } });
    meetLink = cr.meetLink; htmlLink = cr.htmlLink;
  }
  // Libera o slot antigo só depois do patch confirmado
  if (antigo.start) await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id).eq('slot_start', antigo.start);
  await from(supabase, 'leads').update({ meeting_starts_at: start.toISOString() } as Record<string, unknown>).eq('id', req.lead_id);
  if (req.interaction_id) {
    await from(supabase, 'interactions').update({ metadata: { calendar_event_id: eventId, meet_link: meetLink, calendar_link: htmlLink, start_time: start.toISOString(), end_time: end.toISOString(), closer_id: req.closer_id, meeting_request_id: req.id, source: 'bdr_ia', versao } } as Record<string, unknown>).eq('id', req.interaction_id);
  }
  const { data } = (await from(supabase, 'meeting_requests')
    .update({ versao, estado: 'evento_criado', slot_start: start.toISOString(), slot_end: end.toISOString(), google_event_id: eventId, meet_link: meetLink, html_link: htmlLink, erro: null } as Record<string, unknown>)
    .eq('id', req.id).select('*').maybeSingle()) as { data: MeetingRequest | null };
  return data ?? req;
}

export async function cancelRequest(supabase: SupabaseClient, req: MeetingRequest, motivo: string): Promise<void> {
  await from(supabase, 'calendar_slots').delete().eq('meeting_request_id', req.id);
  await from(supabase, 'meeting_requests').update({ estado: 'cancelada', erro: motivo } as Record<string, unknown>).eq('id', req.id);
}

export async function confirmRequest(supabase: SupabaseClient, req: MeetingRequest): Promise<MeetingRequest> {
  if (req.estado !== 'evento_criado') throw new AgendaError('Só confirma solicitação com evento criado', 409, 'estado_invalido');
  const { data } = (await from(supabase, 'meeting_requests').update({ estado: 'confirmada' } as Record<string, unknown>).eq('id', req.id).select('*').maybeSingle()) as { data: MeetingRequest | null };
  return data ?? req;
}
