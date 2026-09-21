import type { SupabaseClient } from '@supabase/supabase-js';

import { from } from '@/lib/supabase/from';

import { admissibleCount, companyKey, diasUteis, effectiveDailyCap, projectCommitments, type StepDelay } from '../services/capacity';

const MAX_ATIVOS_POR_EMPRESA = 2;
const JANELA_RECONTATO_DIAS = 90;

/** Capacidade de e-mail para os próximos N dias úteis e quantos contatos novos cabem hoje. */
export async function computeEmailAdmission(supabase: SupabaseClient, { orgId, cadenceIds, dias = 14, holidays = [] }: {
  orgId: string; cadenceIds: string[]; dias?: number; holidays?: string[];
}) {
  const now = new Date();
  const dates = diasUteis(dias, now, holidays);
  const { data: caixas } = (await from(supabase, 'gmail_connections').select('user_id, email_address, daily_cap, paused_reason, created_at, status')
    .eq('org_id', orgId).eq('bdr_ai', true)) as { data: Array<{ user_id: string; email_address: string; daily_cap: number | null; paused_reason: string | null; created_at: string; status: string }> | null };
  const caps = (caixas ?? []).map((c) => ({ ...c, cap: c.status === 'connected' ? effectiveDailyCap({ dailyCap: c.daily_cap, connectedAt: c.created_at, pausedReason: c.paused_reason, now }) : 0 }));
  const capPerDay = caps.reduce((a, c) => a + c.cap, 0);

  const { data: steps } = (await from(supabase, 'cadence_steps').select('cadence_id, step_order, delay_days, channel').in('cadence_id', cadenceIds)) as { data: Array<StepDelay & { cadence_id: string }> | null };
  const stepsByCadence = new Map<string, StepDelay[]>();
  for (const s of steps ?? []) stepsByCadence.set(s.cadence_id, [...(stepsByCadence.get(s.cadence_id) ?? []), s]);
  const { data: enrollments } = (await from(supabase, 'cadence_enrollments').select('cadence_id, current_step, next_step_due').in('cadence_id', cadenceIds).eq('status', 'active')) as { data: Array<{ cadence_id: string; current_step: number; next_step_due: string | null }> | null };
  const committed = projectCommitments({ enrollments: enrollments ?? [], stepsByCadence, dias: dates });

  // Offsets (em dias úteis) dos e-mails que um contato novo adiciona: cumulativo dos delay_days da cadência de e-mail
  const offsets: number[] = [];
  for (const id of cadenceIds) {
    let acc = 0; let first = true;
    for (const s of (stepsByCadence.get(id) ?? []).filter((x) => x.channel === 'email').sort((a, b) => a.step_order - b.step_order)) {
      if (!first) acc += Math.max(0, s.delay_days); first = false; offsets.push(acc);
    }
  }
  const r = admissibleCount({ dias: dates, capPerDay, committed, offsets: offsets.length ? offsets : [0] });
  return { caixas: caps.map((c) => ({ email: c.email_address, cap: c.cap, pausada: c.paused_reason })), cap_total_dia: capPerDay, offsets, ...r };
}

export interface Candidate { email?: string | null; telefone?: string | null; cnpj?: string | null; empresa?: string | null; external_id?: string | null }

/** Exclusões por candidato: recontato < 90d, em cadência ativa (SDR humano ou IA), hold/opt-out, bounce/supressão, teto por empresa. */
export async function checkCandidates(supabase: SupabaseClient, { orgId, candidates }: { orgId: string; candidates: Candidate[] }) {
  const emails = candidates.map((c) => (c.email ?? '').toLowerCase()).filter(Boolean);
  const phones = candidates.map((c) => (c.telefone ?? '').replace(/\D/g, '')).filter(Boolean);
  const cutoff = new Date(Date.now() - JANELA_RECONTATO_DIAS * 86400000).toISOString();

  const [{ data: leadsByEmail }, { data: leadsByPhone }, { data: suppressed }] = await Promise.all([
    emails.length ? (from(supabase, 'leads').select('id, email, telefone, cnpj, razao_social, nome_fantasia, contacted_at, created_at, status').eq('org_id', orgId).in('email', emails) as unknown as Promise<{ data: LeadRow[] | null }>) : Promise.resolve({ data: [] as LeadRow[] }),
    phones.length ? (from(supabase, 'leads').select('id, email, telefone, cnpj, razao_social, nome_fantasia, contacted_at, created_at, status').eq('org_id', orgId).in('telefone', phones) as unknown as Promise<{ data: LeadRow[] | null }>) : Promise.resolve({ data: [] as LeadRow[] }),
    emails.length ? (from(supabase, 'email_suppressions').select('email').eq('org_id', orgId).in('email', emails) as unknown as Promise<{ data: Array<{ email: string }> | null }>) : Promise.resolve({ data: [] as Array<{ email: string }> }),
  ]);
  const existing = [...(leadsByEmail ?? []), ...(leadsByPhone ?? [])];
  const existingIds = [...new Set(existing.map((l) => l.id))];
  const [{ data: active }, { data: holds }] = await Promise.all([
    existingIds.length ? (from(supabase, 'cadence_enrollments').select('lead_id').in('lead_id', existingIds).eq('status', 'active') as unknown as Promise<{ data: Array<{ lead_id: string }> | null }>) : Promise.resolve({ data: [] as Array<{ lead_id: string }> }),
    existingIds.length ? (from(supabase, 'contact_holds').select('lead_id, tipo').in('lead_id', existingIds) as unknown as Promise<{ data: Array<{ lead_id: string; tipo: string }> | null }>) : Promise.resolve({ data: [] as Array<{ lead_id: string; tipo: string }> }),
  ]);
  const activeSet = new Set((active ?? []).map((a) => a.lead_id));
  const holdSet = new Set((holds ?? []).map((h) => h.lead_id));
  const supSet = new Set((suppressed ?? []).map((s) => s.email.toLowerCase()));

  // Teto por empresa: leads com inscrição ativa agrupados pela chave da empresa
  const { data: ativosOrg } = (await from(supabase, 'cadence_enrollments').select('lead_id').eq('org_id', orgId).eq('status', 'active').limit(5000)) as { data: Array<{ lead_id: string }> | null };
  const ativosIds = (ativosOrg ?? []).map((a) => a.lead_id);
  const { data: ativosLeads } = ativosIds.length
    ? ((await from(supabase, 'leads').select('id, cnpj, razao_social, nome_fantasia').in('id', ativosIds.slice(0, 5000))) as { data: Array<{ id: string; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null }> | null })
    : { data: [] };
  const porEmpresa = new Map<string, number>();
  for (const l of ativosLeads ?? []) { const k = companyKey({ cnpj: l.cnpj, razaoSocial: l.razao_social, nomeFantasia: l.nome_fantasia }); if (k) porEmpresa.set(k, (porEmpresa.get(k) ?? 0) + 1); }

  return candidates.map((c) => {
    const email = (c.email ?? '').toLowerCase();
    const phone = (c.telefone ?? '').replace(/\D/g, '');
    const match = existing.find((l) => (email && l.email?.toLowerCase() === email) || (phone && l.telefone === phone));
    const motivos: string[] = [];
    if (match) {
      if (activeSet.has(match.id)) motivos.push('em_cadencia_ativa');
      if (holdSet.has(match.id)) motivos.push('hold_ou_recusa');
      const ultimo = match.contacted_at ?? match.created_at;
      if (ultimo && ultimo > cutoff) motivos.push('contato_recente_90d');
      if (match.status === 'won') motivos.push('cliente');
    }
    if (email && supSet.has(email)) motivos.push('email_suprimido');
    if (phone && !/^55\d{2}9\d{8}$/.test(phone)) motivos.push('nao_celular_br');
    const key = companyKey({ cnpj: c.cnpj, razaoSocial: c.empresa, nomeFantasia: c.empresa });
    if (key && (porEmpresa.get(key) ?? 0) >= MAX_ATIVOS_POR_EMPRESA) motivos.push('teto_por_empresa');
    if (key && !motivos.length) porEmpresa.set(key, (porEmpresa.get(key) ?? 0) + 1); // reserva a vaga para o lote atual
    return { external_id: c.external_id ?? null, email: email || null, telefone: phone || null, admissivel: motivos.length === 0, motivos, lead_existente_id: match?.id ?? null };
  });
}

type LeadRow = { id: string; email: string | null; telefone: string | null; cnpj: string | null; razao_social: string | null; nome_fantasia: string | null; contacted_at: string | null; created_at: string; status: string };
