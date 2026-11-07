import { from } from '@/lib/supabase/from';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createServiceRoleClient } from '@/lib/supabase/service';

import { readAiOutcome } from '@/features/calls/ai-outcome';

import {
  CALL_CONTEXT_DEFAULT_PER_PAGE,
  CALL_CONTEXT_MAX_PER_PAGE,
  type CallContext,
  type CallContextCall,
  type CallContextInteraction,
  type CallContextPagination,
  type CallContextResult,
  type CallContextSignal,
  type CockpitViewer,
} from '../types';

/**
 * Contexto consolidado e SOMENTE LEITURA de um lead para a ligação (PR02).
 *
 * Flag `call_cockpit_v1` em `app_flags`: a tabela tem apenas key/enabled/note/
 * updated_at, ou seja, escopo GLOBAL (sem org_id). Ligar a flag vale para todas
 * as organizações; o escopo por organização exige trabalho posterior. Em erro de
 * leitura a flag é tratada como desligada (padrão desligado).
 *
 * Com a flag desligada nenhuma tabela de dados é consultada.
 *
 * Permissão: sempre dentro da organização do viewer. Gestor lê qualquer lead da
 * org; SDR e closer só leads da própria carteira (`assigned_to` ou `closer_id`).
 * Lead fora da carteira responde `not_found`, igual a inexistente.
 */
export const CALL_COCKPIT_FLAG_KEY = 'call_cockpit_v1';

const EXCERPT_LENGTH = 280;
const SIGNALS_LIMIT = 10;
const SIGNAL_TYPES = ['replied', 'clicked', 'opened', 'meeting_scheduled', 'bounced'] as const;
const NO_SHOW_WINDOW_DAYS = 14;
const ENGAGED_WINDOW_DAYS = 7;
const DAY_MS = 86_400_000;

export async function isCallCockpitEnabled(): Promise<boolean> {
  try {
    const client = createServiceRoleClient();
    const { data } = (await from(client, 'app_flags')
      .select('enabled')
      .eq('key', CALL_COCKPIT_FLAG_KEY)
      .limit(1)) as { data: Array<{ enabled: boolean }> | null };
    return data?.[0]?.enabled === true;
  } catch {
    return false;
  }
}

interface LeadRow {
  id: string;
  assigned_to: string | null;
  closer_id: string | null;
  nome_fantasia: string | null;
  razao_social: string | null;
  cnpj: string | null;
  segmento: string | null;
  porte: string | null;
  status: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  telefone: string | null;
  socios: unknown;
  fit_score: number | null;
  engagement_score: number | null;
  meeting_no_show_at: string | null;
}

interface InteractionRow {
  id: string;
  channel: string;
  type: string;
  created_at: string;
  message_content: string | null;
  ai_generated: boolean;
}

interface CallRow {
  id: string;
  started_at: string;
  duration_seconds: number;
  connected: boolean;
  status: string;
  sdr_outcome: string | null;
  sdr_disposition: string | null;
  notes: string | null;
  metadata: unknown;
}

const LEAD_COLUMNS =
  'id, assigned_to, closer_id, nome_fantasia, razao_social, cnpj, segmento, porte, status, first_name, last_name, job_title, email, telefone, socios, fit_score, engagement_score, meeting_no_show_at';

export function clampPagination(page?: number, perPage?: number): { page: number; perPage: number } {
  const p = Number.isFinite(page) && (page as number) >= 1 ? Math.floor(page as number) : 1;
  const raw = Number.isFinite(perPage) && (perPage as number) >= 1 ? Math.floor(perPage as number) : CALL_CONTEXT_DEFAULT_PER_PAGE;
  return { page: p, perPage: Math.min(raw, CALL_CONTEXT_MAX_PER_PAGE) };
}

function pagination(page: number, perPage: number, total: number | null, returned: number): CallContextPagination {
  const hasMore = total != null ? page * perPage < total : returned === perPage;
  return { page, perPage, total, hasMore };
}

function partnerNames(socios: unknown): string[] {
  if (!Array.isArray(socios)) return [];
  const names: string[] = [];
  for (const s of socios) {
    const n = typeof s === 'string' ? s : s && typeof s === 'object' ? ((s as Record<string, unknown>).nome ?? (s as Record<string, unknown>).name) : null;
    if (typeof n === 'string' && n.trim()) names.push(n.trim());
    if (names.length === 3) break;
  }
  return names;
}

export function canViewLead(viewer: Pick<CockpitViewer, 'viewerId' | 'isManager'>, lead: Pick<LeadRow, 'assigned_to' | 'closer_id'>): boolean {
  if (viewer.isManager) return true;
  return lead.assigned_to === viewer.viewerId || lead.closer_id === viewer.viewerId;
}

export function resolveWhyNow(input: {
  now: Date;
  signals: CallContextSignal[];
  noShowAt: string | null;
}): CallContext['whyNow'] {
  const { now, signals, noShowAt } = input;
  const age = (iso: string) => now.getTime() - new Date(iso).getTime();
  const reply = signals.find((s) => s.kind === 'replied' && age(s.at) <= ENGAGED_WINDOW_DAYS * DAY_MS);
  if (reply) return { code: 'replied', label: `Respondeu por ${reply.source} recentemente` };
  const callback = signals.find((s) => s.kind === 'callback_requested');
  if (callback) return { code: 'callback_requested', label: 'Pediu retorno por telefone' };
  if (noShowAt && age(noShowAt) <= NO_SHOW_WINDOW_DAYS * DAY_MS) {
    return { code: 'meeting_no_show', label: 'Não compareceu à reunião, vale reagendar' };
  }
  const engaged = signals.find((s) => (s.kind === 'clicked' || s.kind === 'opened') && age(s.at) <= ENGAGED_WINDOW_DAYS * DAY_MS);
  if (engaged) return { code: 'engaged', label: `Interagiu por ${engaged.source} nos últimos dias` };
  return { code: 'no_signal', label: 'Sem sinal recente' };
}

export async function fetchCallContext(input: {
  viewer: CockpitViewer;
  leadId: string;
  page?: number;
  perPage?: number;
  now?: Date;
}): Promise<CallContextResult> {
  if (!(await isCallCockpitEnabled())) return { status: 'disabled' };

  const { viewer, leadId } = input;
  const { page, perPage } = clampPagination(input.page, input.perPage);
  const now = input.now ?? new Date();
  const supabase = await createServerSupabaseClient();

  const leadResult = (await from(supabase, 'leads')
    .select(LEAD_COLUMNS)
    .eq('id', leadId)
    .eq('org_id', viewer.orgId)
    .is('deleted_at', null)
    .maybeSingle()) as { data: LeadRow | null; error: { message: string } | null };

  if (leadResult.error) {
    console.error('[call-context] lead:', leadResult.error.message);
    return { status: 'error', error: 'Falha ao carregar o contexto do lead' };
  }
  const lead = leadResult.data;
  if (!lead || !canViewLead(viewer, lead)) return { status: 'not_found' };

  const rangeFrom = (page - 1) * perPage;
  const rangeTo = rangeFrom + perPage - 1;

  const [interactionsResult, callsResult, signalsResult] = await Promise.all([
    from(supabase, 'interactions')
      .select('id, channel, type, created_at, message_content, ai_generated', { count: 'exact' })
      .eq('org_id', viewer.orgId)
      .eq('lead_id', lead.id)
      .order('created_at', { ascending: false })
      .range(rangeFrom, rangeTo) as unknown as Promise<{
      data: InteractionRow[] | null;
      count: number | null;
      error: { message: string } | null;
    }>,
    from(supabase, 'calls')
      .select('id, started_at, duration_seconds, connected, status, sdr_outcome, sdr_disposition, notes, metadata', { count: 'exact' })
      .eq('org_id', viewer.orgId)
      .eq('lead_id', lead.id)
      .order('started_at', { ascending: false })
      .range(rangeFrom, rangeTo) as unknown as Promise<{
      data: CallRow[] | null;
      count: number | null;
      error: { message: string } | null;
    }>,
    from(supabase, 'interactions')
      .select('channel, type, created_at')
      .eq('org_id', viewer.orgId)
      .eq('lead_id', lead.id)
      .in('type', [...SIGNAL_TYPES])
      .order('created_at', { ascending: false })
      .limit(SIGNALS_LIMIT) as unknown as Promise<{
      data: Array<{ channel: string; type: string; created_at: string }> | null;
      error: { message: string } | null;
    }>,
  ]);

  if (interactionsResult.error) console.error('[call-context] interactions:', interactionsResult.error.message);
  if (callsResult.error) console.error('[call-context] calls:', callsResult.error.message);
  if (signalsResult.error) console.error('[call-context] signals:', signalsResult.error.message);

  const interactions: CallContextInteraction[] = (interactionsResult.data ?? []).map((i) => ({
    id: i.id,
    channel: i.channel,
    type: i.type,
    at: i.created_at,
    excerpt: i.message_content ? i.message_content.slice(0, EXCERPT_LENGTH) : null,
    aiGenerated: i.ai_generated,
  }));

  const callRows = callsResult.data ?? [];
  const calls: CallContextCall[] = callRows.map((c) => {
    const ai = readAiOutcome(c.metadata);
    const aiDone = ai?.status === 'done' ? ai : null;
    return {
      id: c.id,
      at: c.started_at,
      durationSeconds: c.duration_seconds,
      connected: c.connected,
      status: c.status,
      outcome: c.sdr_disposition ?? c.sdr_outcome ?? aiDone?.disposition ?? null,
      summary: aiDone?.summary ?? c.notes ?? null,
    };
  });

  const signals: CallContextSignal[] = (signalsResult.data ?? []).map((s) => ({
    kind: s.type as CallContextSignal['kind'],
    source: s.channel,
    at: s.created_at,
  }));
  // Retorno pedido ao telefone, lido do resultado da IA já gravado nas ligações desta página.
  for (const c of callRows) {
    const ai = readAiOutcome(c.metadata);
    if (ai?.status === 'done' && ai.disposition === 'callback_requested') {
      signals.push({ kind: 'callback_requested', source: 'phone', at: ai.callback_at ?? c.started_at });
    }
  }
  signals.sort((a, b) => b.at.localeCompare(a.at));

  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || null;
  const decisionMaker = {
    name,
    jobTitle: lead.job_title,
    email: lead.email,
    phone: lead.telefone,
    partners: partnerNames(lead.socios),
  };

  const missing: CallContext['missing'] = ['objections'];
  if (!name && !lead.email && !lead.telefone) missing.push('contact');
  if (signals.length === 0) missing.push('signals');
  if (interactions.length === 0) missing.push('interactions');
  if (calls.length === 0) missing.push('calls');
  if (lead.fit_score == null) missing.push('fit');
  if (lead.engagement_score == null) missing.push('engagement');

  const data: CallContext = {
    leadId: lead.id,
    whyNow: resolveWhyNow({ now, signals, noShowAt: lead.meeting_no_show_at }),
    company: {
      name: lead.nome_fantasia ?? lead.razao_social ?? lead.cnpj ?? 'Lead sem nome',
      cnpj: lead.cnpj,
      segmento: lead.segmento,
      porte: lead.porte,
      status: lead.status,
    },
    decisionMaker,
    signals,
    interactions,
    interactionsPage: pagination(page, perPage, interactionsResult.count, interactions.length),
    calls,
    callsPage: pagination(page, perPage, callsResult.count, calls.length),
    // Sem fonte de objeções nos dados atuais (calls/interactions). Fica explícito, não vazio.
    objections: null,
    scores: { fit: lead.fit_score, engagement: lead.engagement_score },
    missing,
  };

  return { status: 'ok', data };
}
