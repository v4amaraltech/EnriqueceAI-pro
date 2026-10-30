import { NextResponse } from 'next/server';

import { verifyServiceRole } from '@/lib/auth/verify-service-role';
import { from } from '@/lib/supabase/from';
import { createServiceRoleClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/utils/uuid';
import { pushConfirmedMeetingToCrm } from '@/features/leads/services/crm-push.service';
import { selectCrmEligibleWonLeads, type CrmSkipReason } from '@/features/leads/services/crm-reconcile.service';

export const maxDuration = 300;

/** Teto da lista explícita — mantém o `.in()` longe do limite de URL do PostgREST. */
const MAX_LEAD_IDS = 100;

interface OrphanLead {
  id: string;
  razao_social: string | null;
  nome_fantasia: string | null;
  cnpj: string | null;
  won_at: string | null;
  closer_id: string | null;
}

/**
 * Worker que (re)cria no CRM o card de leads ganhos que ficaram sem
 * `crm_deal_created` — ex.: o push do feedback "Realizada" falhou por rede
 * (DNS `EAI_AGAIN` do host em 27/10/2026) e nada tenta de novo sozinho.
 *
 * Dois modos:
 *  - `leadIds` (lista explícita): só esses leads, na org informada.
 *  - sem `leadIds`: varre os últimos `limit` ganhos da org (modo original).
 *
 * Em ambos vale a regra do card (story rescheduled-meeting-crm-and-feedback),
 * centralizada em `selectCrmEligibleWonLeads` (mesma regra da reconciliação
 * diária do cron feedback-reminders): lead COM closer só ganha card depois de
 * um feedback "Realizada" (`closer_feedback_requests.result = 'meeting_done'`);
 * lead sem closer entra direto. O push usa `pushConfirmedMeetingToCrm`, que
 * repete em erro de rede e respeita o funil/etapa/
 * responsável escolhidos no modal de Ganho (`crm_options` da interação
 * `lead_won`) e cai nos defaults da conexão quando não houve modal. Cada
 * chamada é idempotente (dedup por `crm_deal_created`), então re-rodar é seguro.
 *
 * POST /api/workers/backfill-kommo-orphans
 * Body: { orgId: string, leadIds?: string[], dryRun?: boolean, limit?: number }
 * Auth: Bearer SUPABASE_SERVICE_ROLE_KEY
 */
export async function POST(request: Request) {
  // Comparação timing-safe da SERVICE_ROLE_KEY (evita side-channel de tempo).
  if (!verifyServiceRole(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as {
    orgId?: string;
    leadIds?: unknown;
    dryRun?: boolean;
    limit?: number;
  };
  const orgId = body.orgId;
  const dryRun = body.dryRun === true;
  const limit = Math.min(body.limit ?? 100, 500);

  if (!orgId || !isUuid(orgId)) {
    return NextResponse.json({ error: 'orgId required' }, { status: 400 });
  }

  let leadIds: string[] | null = null;
  if (body.leadIds !== undefined) {
    if (!Array.isArray(body.leadIds) || body.leadIds.length === 0 || !body.leadIds.every(isUuid)) {
      return NextResponse.json({ error: 'leadIds must be a non-empty array of UUIDs' }, { status: 400 });
    }
    if (body.leadIds.length > MAX_LEAD_IDS) {
      return NextResponse.json({ error: `leadIds: max ${MAX_LEAD_IDS} per call` }, { status: 400 });
    }
    leadIds = [...new Set(body.leadIds as string[])];
  }

  const supabase = createServiceRoleClient();

  // Leads ganhos da org: a lista explícita ou os últimos `limit`. Service role +
  // filtro explícito de org (RLS não se aplica em modo service).
  const wonQuery = () =>
    from(supabase, 'leads')
      .select('id, razao_social, nome_fantasia, cnpj, won_at, closer_id')
      .eq('org_id', orgId)
      .eq('status', 'won')
      .is('deleted_at', null);
  const { data: wonLeads } = (await (leadIds
    ? wonQuery().in('id', leadIds)
    : wonQuery().order('won_at', { ascending: false }).limit(limit))) as { data: OrphanLead[] | null };

  const found = wonLeads ?? [];
  // Pedidos que não bateram em lead ganho da org (id errado, outra org,
  // reaberto pelo closer, apagado) — devolvidos para o operador conferir.
  const notFound = leadIds ? leadIds.filter((id) => !found.some((l) => l.id === id)) : [];

  if (found.length === 0) {
    return NextResponse.json({ found: 0, pushed: 0, skipped: 0, failed: 0, notFound, message: 'No won leads' });
  }

  // Já sincronizado → fora; com closer sem "Realizada" → fora; o resto entra.
  const { candidates, skipped }: { candidates: OrphanLead[]; skipped: Array<{ id: string; reason: CrmSkipReason }> } =
    await selectCrmEligibleWonLeads(supabase, found);

  const describe = (l: OrphanLead) => ({
    id: l.id,
    razao_social: l.razao_social,
    nome_fantasia: l.nome_fantasia,
    cnpj: l.cnpj,
    won_at: l.won_at,
  });

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      found: candidates.length,
      leads: candidates.map(describe),
      skipped,
      notFound,
    });
  }

  const results: Array<{ id: string; razao_social: string | null; nome_fantasia: string | null; result: unknown }> = [];
  let pushed = 0;
  let notCreated = 0;
  let failed = 0;

  for (const lead of candidates) {
    try {
      const r = await pushConfirmedMeetingToCrm(orgId, lead.id);
      if (r.dealCreated) {
        pushed++;
      } else {
        // skippedReason (ex.: no_contact_id quando o Kommo está fora) ou
        // retorno sem deal: conta como não criado, detalhe vai em `results`.
        notCreated++;
      }
      results.push({ id: lead.id, razao_social: lead.razao_social, nome_fantasia: lead.nome_fantasia, result: r });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : 'unknown';
      results.push({ id: lead.id, razao_social: lead.razao_social, nome_fantasia: lead.nome_fantasia, result: { error: msg } });
    }
  }

  return NextResponse.json({
    found: candidates.length,
    pushed,
    notCreated,
    failed,
    skipped,
    notFound,
    results,
  });
}
